
-- 1. Extend bank_accounts
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS opening_balance_statement numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_ledger numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date date;

ALTER TABLE public.bank_accounts ALTER COLUMN company_id DROP NOT NULL;

-- 2. bank_account_companies join
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

-- Backfill from existing bank_accounts.company_id
INSERT INTO public.bank_account_companies (bank_account_id, company_id)
SELECT id, company_id FROM public.bank_accounts
WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. data_sets
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

-- 4. Stamp period + data_set_id on transactions/records
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

-- 5. open_items
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
