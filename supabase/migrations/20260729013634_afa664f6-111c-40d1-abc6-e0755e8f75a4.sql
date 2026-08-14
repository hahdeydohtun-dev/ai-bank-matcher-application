CREATE POLICY "members delete companies"
  ON public.companies
  FOR DELETE
  TO authenticated
  USING (public.is_company_member(id));

CREATE POLICY "members update own membership"
  ON public.company_members
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "members delete own membership"
  ON public.company_members
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_company_member(company_id));