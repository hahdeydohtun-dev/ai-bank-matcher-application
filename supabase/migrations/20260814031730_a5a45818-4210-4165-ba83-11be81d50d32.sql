CREATE TABLE IF NOT EXISTS public.bank_account_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, company_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_account_companies TO authenticated;
GRANT ALL ON public.bank_account_companies TO service_role;
ALTER TABLE public.bank_account_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage bank account companies"
  ON public.bank_account_companies
  FOR ALL
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
INSERT INTO public.bank_account_companies (bank_account_id, company_id)
SELECT id, company_id FROM public.bank_accounts
WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.data_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  source text NOT NULL,
  period_start date,
  period_end date,
  label text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_by_email text,
  upload_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_sets_scope_idx ON public.data_sets (company_id, bank_account_id, source, upload_timestamp DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_sets TO authenticated;
GRANT ALL ON public.data_sets TO service_role;
ALTER TABLE public.data_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage data sets"
  ON public.data_sets
  FOR ALL
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS data_set_id uuid REFERENCES public.data_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;
CREATE INDEX IF NOT EXISTS bank_txn_period_idx ON public.bank_transactions (company_id, bank_account_id, period_start, period_end);
ALTER TABLE public.accounting_records
  ADD COLUMN IF NOT EXISTS data_set_id uuid REFERENCES public.data_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;
CREATE INDEX IF NOT EXISTS acct_rec_period_idx ON public.accounting_records (company_id, bank_account_id, period_start, period_end);
CREATE TABLE IF NOT EXISTS public.open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  source text NOT NULL,
  as_at_date date NOT NULL,
  doc_ref text,
  amount numeric NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'debit',
  party_name text,
  narration text,
  status text NOT NULL DEFAULT 'open',
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS open_items_scope_idx ON public.open_items (company_id, bank_account_id, source, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_items TO authenticated;
GRANT ALL ON public.open_items TO service_role;
ALTER TABLE public.open_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage open items"
  ON public.open_items
  FOR ALL
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
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
DROP POLICY IF EXISTS "authenticated can create companies" ON public.companies;
CREATE POLICY "authenticated can create companies"
  ON public.companies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.match_suggestions ADD COLUMN IF NOT EXISTS rejection_reason text;
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
UPDATE public.import_batches ib
SET bank_account_id = scoped.bank_account_id
FROM (
  SELECT import_batch_id, (ARRAY_AGG(bank_account_id))[1] AS bank_account_id
  FROM public.accounting_records
  WHERE import_batch_id IS NOT NULL
    AND bank_account_id IS NOT NULL
  GROUP BY import_batch_id
  HAVING COUNT(DISTINCT bank_account_id) = 1
) scoped
WHERE ib.id = scoped.import_batch_id
  AND ib.source = 'ledger'
  AND ib.bank_account_id IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounting_records_company_id_doc_number_key'
      AND conrelid = 'public.accounting_records'::regclass
  ) THEN
    ALTER TABLE public.accounting_records
      DROP CONSTRAINT accounting_records_company_id_doc_number_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS accounting_records_company_bank_account_doc_number_key
  ON public.accounting_records (company_id, bank_account_id, doc_number);
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_bank_account_access(uuid) FROM authenticated, anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_bank_account_access(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_bank_account_access(uuid) FROM anon;
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
ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_bank_account_id_txn_ref_key;
DROP INDEX IF EXISTS public.bank_transactions_bank_account_id_txn_ref_key;