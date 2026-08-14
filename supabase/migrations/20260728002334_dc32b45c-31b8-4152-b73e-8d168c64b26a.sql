
CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bank_account_id uuid,
  source text NOT NULL DEFAULT 'bank',
  label text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage import batches" ON public.import_batches FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));

CREATE TABLE public.match_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bank_transaction_ids uuid[] NOT NULL DEFAULT '{}',
  accounting_record_ids uuid[] NOT NULL DEFAULT '{}',
  bank_total numeric NOT NULL DEFAULT 0,
  ledger_total numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  note text,
  status text NOT NULL DEFAULT 'reconciled',
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_groups TO authenticated;
GRANT ALL ON public.match_groups TO service_role;
ALTER TABLE public.match_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage match groups" ON public.match_groups FOR ALL TO authenticated
  USING (public.is_company_member(company_id)) WITH CHECK (public.is_company_member(company_id));

ALTER TABLE public.bank_transactions
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN match_group_id uuid;

ALTER TABLE public.accounting_records
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN match_group_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'open',
  ADD COLUMN reconciled_txn_id uuid,
  ADD COLUMN resolved_by_email text,
  ADD COLUMN resolved_at timestamptz;

CREATE INDEX idx_bank_txn_batch ON public.bank_transactions (import_batch_id);
CREATE INDEX idx_records_batch ON public.accounting_records (import_batch_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_import_batches_updated_at BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_match_groups_updated_at BEFORE UPDATE ON public.match_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- allow creating companies / memberships / bank accounts from the app
CREATE POLICY "authenticated can create companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "members update own company" ON public.companies FOR UPDATE TO authenticated
  USING (public.is_company_member(id)) WITH CHECK (public.is_company_member(id));
CREATE POLICY "users add own membership" ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.import_batches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.accounting_records;
