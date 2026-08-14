
-- 1. Lock down SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;

-- 2. Bank-account-scoped membership helper (many-to-many aware)
CREATE OR REPLACE FUNCTION public.has_bank_account_access(_bank_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bank_account_companies bac
    JOIN public.company_members cm ON cm.company_id = bac.company_id
    WHERE bac.bank_account_id = _bank_account_id
      AND cm.user_id = auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION public.has_bank_account_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_bank_account_access(uuid) TO authenticated;

-- 3. Fix bank_accounts policies for the many-to-many model
DROP POLICY IF EXISTS "members manage bank accounts" ON public.bank_accounts;

CREATE POLICY "members read bank accounts"
  ON public.bank_accounts FOR SELECT TO authenticated
  USING (
    (company_id IS NOT NULL AND public.is_company_member(company_id))
    OR public.has_bank_account_access(id)
  );

CREATE POLICY "authenticated insert bank accounts"
  ON public.bank_accounts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "members update bank accounts"
  ON public.bank_accounts FOR UPDATE TO authenticated
  USING (
    (company_id IS NOT NULL AND public.is_company_member(company_id))
    OR public.has_bank_account_access(id)
  )
  WITH CHECK (
    (company_id IS NOT NULL AND public.is_company_member(company_id))
    OR public.has_bank_account_access(id)
  );

CREATE POLICY "members delete bank accounts"
  ON public.bank_accounts FOR DELETE TO authenticated
  USING (
    (company_id IS NOT NULL AND public.is_company_member(company_id))
    OR public.has_bank_account_access(id)
  );

-- 4. Tighten permissive company insert
DROP POLICY IF EXISTS "authenticated can create companies" ON public.companies;
CREATE POLICY "authenticated can create companies"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
