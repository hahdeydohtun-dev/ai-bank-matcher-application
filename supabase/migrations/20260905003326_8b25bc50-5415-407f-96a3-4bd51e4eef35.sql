CREATE OR REPLACE FUNCTION private.is_company_admin(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = _company_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner','admin')
  )
$$;

REVOKE ALL ON FUNCTION private.is_company_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_company_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS "members insert bank api connections" ON public.bank_api_connections;
DROP POLICY IF EXISTS "members update bank api connections" ON public.bank_api_connections;
DROP POLICY IF EXISTS "members delete bank api connections" ON public.bank_api_connections;
CREATE POLICY "admins insert bank api connections" ON public.bank_api_connections
  FOR INSERT TO authenticated WITH CHECK (private.is_company_admin(company_id));
CREATE POLICY "admins update bank api connections" ON public.bank_api_connections
  FOR UPDATE TO authenticated USING (private.is_company_admin(company_id)) WITH CHECK (private.is_company_admin(company_id));
CREATE POLICY "admins delete bank api connections" ON public.bank_api_connections
  FOR DELETE TO authenticated USING (private.is_company_admin(company_id));

DROP POLICY IF EXISTS "members insert erp api connections" ON public.erp_api_connections;
DROP POLICY IF EXISTS "members update erp api connections" ON public.erp_api_connections;
DROP POLICY IF EXISTS "members delete erp api connections" ON public.erp_api_connections;
CREATE POLICY "admins insert erp api connections" ON public.erp_api_connections
  FOR INSERT TO authenticated WITH CHECK (private.is_company_admin(company_id));
CREATE POLICY "admins update erp api connections" ON public.erp_api_connections
  FOR UPDATE TO authenticated USING (private.is_company_admin(company_id)) WITH CHECK (private.is_company_admin(company_id));
CREATE POLICY "admins delete erp api connections" ON public.erp_api_connections
  FOR DELETE TO authenticated USING (private.is_company_admin(company_id));