revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_company_member(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;