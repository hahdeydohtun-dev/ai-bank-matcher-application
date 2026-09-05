drop policy if exists "authenticated insert bank accounts" on public.bank_accounts;
create policy "authenticated insert bank accounts"
on public.bank_accounts
for insert to authenticated
with check (company_id is null or private.is_company_member(company_id));

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_last_member_removal() from public, anon, authenticated;
revoke execute on function public.accept_company_invite(uuid) from public, anon;
revoke execute on function public.create_company_with_owner(text, text) from public, anon;
revoke execute on function public.set_company_member_role(uuid, text) from public, anon;