CREATE TABLE public.bank_api_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  provider_label text,
  endpoint_url text NOT NULL,
  auth_type text NOT NULL DEFAULT 'bearer',
  api_key text,
  api_secret text,
  extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, company_id)
);
GRANT SELECT (id, company_id, bank_account_id, enabled, provider_label, endpoint_url, auth_type, extra_headers, last_fetched_at, created_at, updated_at) ON public.bank_api_connections TO authenticated;
GRANT INSERT, UPDATE ON public.bank_api_connections TO authenticated;
GRANT DELETE ON public.bank_api_connections TO authenticated;
GRANT ALL ON public.bank_api_connections TO service_role;
ALTER TABLE public.bank_api_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read bank api connections" ON public.bank_api_connections
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY "members insert bank api connections" ON public.bank_api_connections
  FOR INSERT TO authenticated WITH CHECK (private.is_company_member(company_id));
CREATE POLICY "members update bank api connections" ON public.bank_api_connections
  FOR UPDATE TO authenticated USING (private.is_company_member(company_id)) WITH CHECK (private.is_company_member(company_id));
CREATE POLICY "members delete bank api connections" ON public.bank_api_connections
  FOR DELETE TO authenticated USING (private.is_company_member(company_id));
CREATE TRIGGER update_bank_api_connections_updated_at
  BEFORE UPDATE ON public.bank_api_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.erp_api_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  erp_system text,
  gl_account_code text,
  endpoint_url text NOT NULL,
  auth_type text NOT NULL DEFAULT 'bearer',
  api_key text,
  api_secret text,
  extra_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, company_id)
);
GRANT SELECT (id, company_id, bank_account_id, enabled, erp_system, gl_account_code, endpoint_url, auth_type, extra_headers, last_fetched_at, created_at, updated_at) ON public.erp_api_connections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.erp_api_connections TO authenticated;
GRANT ALL ON public.erp_api_connections TO service_role;
ALTER TABLE public.erp_api_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read erp api connections" ON public.erp_api_connections
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY "members insert erp api connections" ON public.erp_api_connections
  FOR INSERT TO authenticated WITH CHECK (private.is_company_member(company_id));
CREATE POLICY "members update erp api connections" ON public.erp_api_connections
  FOR UPDATE TO authenticated USING (private.is_company_member(company_id)) WITH CHECK (private.is_company_member(company_id));
CREATE POLICY "members delete erp api connections" ON public.erp_api_connections
  FOR DELETE TO authenticated USING (private.is_company_member(company_id));
CREATE TRIGGER update_erp_api_connections_updated_at
  BEFORE UPDATE ON public.erp_api_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.data_sets ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS data_sets_idempotency_key_uidx
  ON public.data_sets (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "read co-member profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.company_members mine
      JOIN public.company_members theirs ON theirs.company_id = mine.company_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = profiles.id
    )
  );
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon, PUBLIC;
INSERT INTO public.profiles (id, email)
SELECT u.id, u.email FROM auth.users u
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "users add own membership" ON public.company_members;
DROP POLICY IF EXISTS "authenticated can create companies" ON public.companies;
REVOKE INSERT ON public.company_members FROM authenticated;
REVOKE INSERT ON public.companies FROM authenticated;
CREATE OR REPLACE FUNCTION public.create_company_with_owner(_name text, _currency text DEFAULT 'NGN')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
REVOKE ALL ON FUNCTION public.create_company_with_owner(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_with_owner(text, text) TO authenticated;
CREATE TABLE public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  invited_by uuid NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid
);
CREATE UNIQUE INDEX company_invites_pending_unique
  ON public.company_invites (company_id, lower(email))
  WHERE status = 'pending';
CREATE INDEX idx_company_invites_company ON public.company_invites (company_id);
CREATE INDEX idx_company_invites_token ON public.company_invites (token);
ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read invites" ON public.company_invites
  FOR SELECT TO authenticated USING (
    private.is_company_member(company_id)
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
CREATE POLICY "members create invites" ON public.company_invites
  FOR INSERT TO authenticated
  WITH CHECK (private.is_company_member(company_id) AND invited_by = auth.uid());
CREATE POLICY "members revoke invites" ON public.company_invites
  FOR UPDATE TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));
CREATE POLICY "members delete invites" ON public.company_invites
  FOR DELETE TO authenticated USING (private.is_company_member(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invites TO authenticated;
GRANT ALL ON public.company_invites TO service_role;
CREATE OR REPLACE FUNCTION public.accept_company_invite(_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
REVOKE ALL ON FUNCTION public.accept_company_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_invite(uuid) TO authenticated;
ALTER TABLE public.company_invites REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_invites;
CREATE TABLE public.company_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_threshold numeric(6,2) NOT NULL DEFAULT 85,
  review_threshold numeric(6,2) NOT NULL DEFAULT 60,
  high_value_threshold numeric(18,2) NOT NULL DEFAULT 3000000,
  aging_days integer NOT NULL DEFAULT 14,
  bank_charge_auto_match boolean NOT NULL DEFAULT true,
  bank_charge_keywords text[] NOT NULL DEFAULT array[
    'CHARGE','CHARGES','COMMISSION','COT','VAT','STAMP DUTY','SMS ALERT',
    'MAINTENANCE FEE','TRANSFER FEE','LEVY','NIP FEE','BANK FEE'
  ],
  charge_tolerance numeric(6,2) NOT NULL DEFAULT 2,
  theme text NOT NULL DEFAULT 'navy',
  updated_by_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage company settings" ON public.company_settings
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;
CREATE TRIGGER update_company_settings_updated_at BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.company_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_settings;
CREATE TABLE public.import_mapping_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'bank_csv',
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, name)
);
ALTER TABLE public.import_mapping_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage import mapping presets" ON public.import_mapping_presets
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_mapping_presets TO authenticated;
GRANT ALL ON public.import_mapping_presets TO service_role;
CREATE TRIGGER update_import_mapping_presets_updated_at BEFORE UPDATE ON public.import_mapping_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  accounting_record_id uuid REFERENCES public.accounting_records(id) ON DELETE SET NULL,
  amount_score numeric(6,2) NOT NULL DEFAULT 0,
  reference_score numeric(6,2) NOT NULL DEFAULT 0,
  date_score numeric(6,2) NOT NULL DEFAULT 0,
  party_score numeric(6,2) NOT NULL DEFAULT 0,
  side_score numeric(6,2) NOT NULL DEFAULT 0,
  confidence numeric(6,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'suggestion',
  accepted boolean NOT NULL,
  decided_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_decisions_company ON public.match_decisions (company_id, created_at DESC);
ALTER TABLE public.match_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage match decisions" ON public.match_decisions
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_decisions TO authenticated;
GRANT ALL ON public.match_decisions TO service_role;
CREATE TABLE public.matching_weights (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  amount_weight numeric(6,4) NOT NULL DEFAULT 0.30,
  reference_weight numeric(6,4) NOT NULL DEFAULT 0.25,
  date_weight numeric(6,4) NOT NULL DEFAULT 0.20,
  party_weight numeric(6,4) NOT NULL DEFAULT 0.15,
  side_weight numeric(6,4) NOT NULL DEFAULT 0.10,
  sample_size integer NOT NULL DEFAULT 0,
  suggested_auto_threshold numeric(6,2),
  suggested_review_threshold numeric(6,2),
  recalibrated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.matching_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage matching weights" ON public.matching_weights
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matching_weights TO authenticated;
GRANT ALL ON public.matching_weights TO service_role;
DROP POLICY IF EXISTS "members update own membership" ON public.company_members;
REVOKE UPDATE ON public.company_members FROM authenticated;
CREATE OR REPLACE FUNCTION public.set_company_member_role(_member_id uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
REVOKE ALL ON FUNCTION public.set_company_member_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_member_role(uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.prevent_last_member_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
REVOKE ALL ON FUNCTION public.prevent_last_member_removal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prevent_last_member_removal ON public.company_members;
CREATE TRIGGER trg_prevent_last_member_removal
  BEFORE DELETE ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_member_removal();