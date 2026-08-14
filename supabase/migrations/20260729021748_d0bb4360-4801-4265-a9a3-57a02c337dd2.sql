REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_bank_account_access(uuid) FROM authenticated, anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated, anon, PUBLIC;