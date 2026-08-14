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