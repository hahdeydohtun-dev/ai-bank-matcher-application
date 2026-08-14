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
  last_fetched_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
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