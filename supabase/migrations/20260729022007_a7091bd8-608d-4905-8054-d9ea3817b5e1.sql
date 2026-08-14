CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_company_member(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = _company_id
      AND m.user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION private.has_bank_account_access(_bank_account_id uuid)
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

REVOKE ALL ON FUNCTION private.is_company_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_bank_account_access(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_bank_account_access(uuid) TO authenticated;

ALTER POLICY "members manage accounting records"
ON public.accounting_records
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members manage bank account companies"
ON public.bank_account_companies
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members read bank accounts"
ON public.bank_accounts
USING (((company_id IS NOT NULL) AND private.is_company_member(company_id)) OR private.has_bank_account_access(id));

ALTER POLICY "members update bank accounts"
ON public.bank_accounts
USING (((company_id IS NOT NULL) AND private.is_company_member(company_id)) OR private.has_bank_account_access(id))
WITH CHECK (((company_id IS NOT NULL) AND private.is_company_member(company_id)) OR private.has_bank_account_access(id));

ALTER POLICY "members delete bank accounts"
ON public.bank_accounts
USING (((company_id IS NOT NULL) AND private.is_company_member(company_id)) OR private.has_bank_account_access(id));

ALTER POLICY "members manage bank transactions"
ON public.bank_transactions
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members read companies"
ON public.companies
USING (private.is_company_member(id));

ALTER POLICY "members update own company"
ON public.companies
USING (private.is_company_member(id))
WITH CHECK (private.is_company_member(id));

ALTER POLICY "members delete companies"
ON public.companies
USING (private.is_company_member(id));

ALTER POLICY "members read own memberships"
ON public.company_members
USING ((user_id = auth.uid()) OR private.is_company_member(company_id));

ALTER POLICY "members update own membership"
ON public.company_members
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

ALTER POLICY "members delete own membership"
ON public.company_members
USING ((user_id = auth.uid()) OR private.is_company_member(company_id));

ALTER POLICY "members manage data sets"
ON public.data_sets
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members manage import batches"
ON public.import_batches
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members manage match groups"
ON public.match_groups
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members manage match suggestions"
ON public.match_suggestions
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

ALTER POLICY "members manage open items"
ON public.open_items
USING (private.is_company_member(company_id))
WITH CHECK (private.is_company_member(company_id));

REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_bank_account_access(uuid) FROM authenticated, anon, PUBLIC;