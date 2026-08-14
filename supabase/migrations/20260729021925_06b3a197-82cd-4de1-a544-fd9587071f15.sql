GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_bank_account_access(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_bank_account_access(uuid) FROM anon;