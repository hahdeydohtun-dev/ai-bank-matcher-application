-- =====================================================================
-- SaaS hardening pass:
--   1. Stop every new signup from being auto-enrolled in the seeded demo
--      company, and replace that trigger with a `profiles` table so users
--      can be looked up by email (needed for invites below).
--   2. Close the "join any company by id" hole: company_members can no
--      longer be inserted directly by the client. Membership can only be
--      created by (a) create_company_with_owner, when you make a company,
--      or (b) accept_company_invite, when someone invites you.
--   3. Add company_invites + accept flow, so teams can actually add
--      colleagues to a workspace.
--   4. Add company_settings and import_mapping_presets so matching
--      thresholds and CSV mapping presets are shared/team-scoped instead
--      of living in each person's localStorage.
--   5. Add match_decisions, the log of human accept/reject outcomes that
--      the adaptive weight learner (adaptiveWeights.ts) trains on, plus
--      matching_weights to store each company's current learned weights.
-- =====================================================================

-- ---------- 1. profiles (replaces the demo-company auto-join trigger) ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "read co-member profiles" on public.profiles
  for select to authenticated using (
    exists (
      select 1
      from public.company_members mine
      join public.company_members theirs on theirs.company_id = mine.company_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Replace the body of the existing signup trigger function. This function
-- (and the `on_auth_user_created` trigger bound to it) already exists from
-- the initial migration; CREATE OR REPLACE swaps its behavior in place so
-- we don't need to touch the trigger itself.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from authenticated, anon, public;

-- Backfill profiles for any users who already signed up under the old trigger.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- ---------- 2. lock down company/membership creation ----------

-- These previously let ANY authenticated user insert a company_members row
-- for ANY company_id (the insert check only verified `user_id = auth.uid()`,
-- never that the caller had a right to join that company) and let anyone
-- create a bare company row directly. Both are replaced by the
-- SECURITY DEFINER functions below, which are the only supported way to
-- create a company or add yourself as a member from now on.
drop policy if exists "users add own membership" on public.company_members;
drop policy if exists "authenticated can create companies" on public.companies;
revoke insert on public.company_members from authenticated;
revoke insert on public.companies from authenticated;

create or replace function public.create_company_with_owner(_name text, _currency text default 'NGN')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(_name), '') = '' then
    raise exception 'Company name is required';
  end if;

  insert into public.companies (name, currency)
  values (trim(_name), coalesce(nullif(trim(_currency), ''), 'NGN'))
  returning id into new_id;

  insert into public.company_members (company_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return new_id;
end;
$$;

revoke all on function public.create_company_with_owner(text, text) from public, anon;
grant execute on function public.create_company_with_owner(text, text) to authenticated;

-- ---------- 3. team invites ----------

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  invited_by uuid not null,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending', -- pending | accepted | revoked | expired
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid
);

create unique index company_invites_pending_unique
  on public.company_invites (company_id, lower(email))
  where status = 'pending';

create index idx_company_invites_company on public.company_invites (company_id);
create index idx_company_invites_token on public.company_invites (token);

alter table public.company_invites enable row level security;

create policy "members read invites" on public.company_invites
  for select to authenticated using (
    private.is_company_member(company_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "members create invites" on public.company_invites
  for insert to authenticated
  with check (private.is_company_member(company_id) and invited_by = auth.uid());

create policy "members revoke invites" on public.company_invites
  for update to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

create policy "members delete invites" on public.company_invites
  for delete to authenticated using (private.is_company_member(company_id));

grant select, insert, update, delete on public.company_invites to authenticated;
grant all on public.company_invites to service_role;

create or replace function public.accept_company_invite(_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  caller_email text;
  target_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select email into caller_email from auth.users where id = auth.uid();
  if caller_email is null then
    raise exception 'Could not resolve your account email';
  end if;

  select * into inv from public.company_invites
  where token = _token and status = 'pending'
  for update;

  if inv is null then
    raise exception 'This invite is no longer valid.';
  end if;

  if inv.expires_at < now() then
    update public.company_invites set status = 'expired' where id = inv.id;
    raise exception 'This invite has expired.';
  end if;

  if lower(inv.email) <> lower(caller_email) then
    raise exception 'This invite was sent to a different email address.';
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (inv.company_id, auth.uid(), inv.role)
  on conflict (company_id, user_id) do nothing;

  update public.company_invites
  set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id
  returning company_id into target_company;

  return target_company;
end;
$$;

revoke all on function public.accept_company_invite(uuid) from public, anon;
grant execute on function public.accept_company_invite(uuid) to authenticated;

alter table public.company_invites replica identity full;
alter publication supabase_realtime add table public.company_invites;

-- ---------- 4. company-scoped settings & import mapping presets ----------
-- (moves matching thresholds and CSV column-mapping presets out of
-- localStorage so a whole team shares one configuration per company)

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  auto_threshold numeric(6,2) not null default 85,
  review_threshold numeric(6,2) not null default 60,
  high_value_threshold numeric(18,2) not null default 3000000,
  aging_days integer not null default 14,
  bank_charge_auto_match boolean not null default true,
  bank_charge_keywords text[] not null default array[
    'CHARGE','CHARGES','COMMISSION','COT','VAT','STAMP DUTY','SMS ALERT',
    'MAINTENANCE FEE','TRANSFER FEE','LEVY','NIP FEE','BANK FEE'
  ],
  charge_tolerance numeric(6,2) not null default 2,
  theme text not null default 'navy',
  updated_by_email text,
  updated_at timestamptz not null default now()
);

alter table public.company_settings enable row level security;

create policy "members manage company settings" on public.company_settings
  for all to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

grant select, insert, update, delete on public.company_settings to authenticated;
grant all on public.company_settings to service_role;

create trigger update_company_settings_updated_at before update on public.company_settings
  for each row execute function public.update_updated_at_column();

alter table public.company_settings replica identity full;
alter publication supabase_realtime add table public.company_settings;

create table public.import_mapping_presets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null default 'bank_csv', -- bank_csv | ledger_csv
  mapping jsonb not null default '{}'::jsonb,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, name)
);

alter table public.import_mapping_presets enable row level security;

create policy "members manage import mapping presets" on public.import_mapping_presets
  for all to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

grant select, insert, update, delete on public.import_mapping_presets to authenticated;
grant all on public.import_mapping_presets to service_role;

create trigger update_import_mapping_presets_updated_at before update on public.import_mapping_presets
  for each row execute function public.update_updated_at_column();

-- ---------- 5. adaptive matching: decision log + learned weights ----------

create table public.match_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  accounting_record_id uuid references public.accounting_records(id) on delete set null,
  amount_score numeric(6,2) not null default 0,
  reference_score numeric(6,2) not null default 0,
  date_score numeric(6,2) not null default 0,
  party_score numeric(6,2) not null default 0,
  side_score numeric(6,2) not null default 0,
  confidence numeric(6,2) not null default 0,
  source text not null default 'suggestion', -- suggestion | manual
  accepted boolean not null,
  decided_by_email text,
  created_at timestamptz not null default now()
);

create index idx_match_decisions_company on public.match_decisions (company_id, created_at desc);

alter table public.match_decisions enable row level security;

create policy "members manage match decisions" on public.match_decisions
  for all to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

grant select, insert, update, delete on public.match_decisions to authenticated;
grant all on public.match_decisions to service_role;

create table public.matching_weights (
  company_id uuid primary key references public.companies(id) on delete cascade,
  amount_weight numeric(6,4) not null default 0.30,
  reference_weight numeric(6,4) not null default 0.25,
  date_weight numeric(6,4) not null default 0.20,
  party_weight numeric(6,4) not null default 0.15,
  side_weight numeric(6,4) not null default 0.10,
  sample_size integer not null default 0,
  suggested_auto_threshold numeric(6,2),
  suggested_review_threshold numeric(6,2),
  recalibrated_at timestamptz not null default now()
);

alter table public.matching_weights enable row level security;

create policy "members manage matching weights" on public.matching_weights
  for all to authenticated
  using (private.is_company_member(company_id))
  with check (private.is_company_member(company_id));

grant select, insert, update, delete on public.matching_weights to authenticated;
grant all on public.matching_weights to service_role;
