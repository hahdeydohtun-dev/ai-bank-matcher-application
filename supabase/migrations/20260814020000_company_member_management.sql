-- =====================================================================
-- Team management follow-up:
--   1. Close a privilege-escalation hole: "members update own membership"
--      let any member set THEIR OWN role column to anything at all
--      (including 'owner') with no value check. Replace direct-update
--      self-service with set_company_member_role(), a SECURITY DEFINER
--      function that validates the role against an allow-list. This
--      matches the flat-trust model used everywhere else in this app
--      (any company member can manage shared company resources) rather
--      than introducing a new tiered-permission concept that nothing
--      else enforces.
--   2. Guard against a company being left with zero members: the existing
--      "members delete own membership" policy already lets any member
--      remove any member (its name undersells what it does — the
--      is_company_member(company_id) OR-clause makes it company-wide,
--      not self-only), which is fine, but nothing stopped the last
--      remaining member from being removed and orphaning the company.
--      A BEFORE DELETE trigger enforces "at least one member remains"
--      regardless of which path the delete comes through.
-- =====================================================================

-- ---------- 1. role changes go through a validated RPC ----------

drop policy if exists "members update own membership" on public.company_members;
revoke update on public.company_members from authenticated;

create or replace function public.set_company_member_role(_member_id uuid, _role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if _role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role: %', _role;
  end if;

  select * into target from public.company_members where id = _member_id;
  if target is null then
    raise exception 'Membership not found';
  end if;
  if not private.is_company_member(target.company_id) then
    raise exception 'Not a member of this company';
  end if;

  update public.company_members set role = _role where id = _member_id;
end;
$$;

revoke all on function public.set_company_member_role(uuid, text) from public, anon;
grant execute on function public.set_company_member_role(uuid, text) to authenticated;

-- ---------- 2. never let a company drop to zero members ----------

create or replace function public.prevent_last_member_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  select count(*) into remaining
  from public.company_members
  where company_id = old.company_id and id <> old.id;

  if remaining = 0 then
    raise exception 'Cannot remove the last member of a company. Delete the company instead.';
  end if;

  return old;
end;
$$;

revoke all on function public.prevent_last_member_removal() from public, anon, authenticated;

drop trigger if exists trg_prevent_last_member_removal on public.company_members;
create trigger trg_prevent_last_member_removal
  before delete on public.company_members
  for each row execute function public.prevent_last_member_removal();
