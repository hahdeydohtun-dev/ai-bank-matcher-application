CREATE TABLE public.reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  reconciliation_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  period_start date,
  period_end date,
  as_of_date date NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  bank_statement_balance numeric NOT NULL DEFAULT 0,
  gl_balance numeric NOT NULL DEFAULT 0,
  ledger_debits_not_in_bank numeric NOT NULL DEFAULT 0,
  ledger_credits_not_in_bank numeric NOT NULL DEFAULT 0,
  bank_credits_not_in_ledger numeric NOT NULL DEFAULT 0,
  bank_debits_not_in_ledger numeric NOT NULL DEFAULT 0,
  adjusted_bank_balance numeric NOT NULL DEFAULT 0,
  adjusted_book_balance numeric NOT NULL DEFAULT 0,
  unreconciled_difference numeric NOT NULL DEFAULT 0,
  tolerance numeric NOT NULL DEFAULT 0.01,
  matched_count integer NOT NULL DEFAULT 0,
  bank_txn_count integer NOT NULL DEFAULT 0,
  ledger_txn_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'generated',
  change_reason text,
  prepared_by text,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  finalized_by text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, reconciliation_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_reports TO authenticated;
GRANT ALL ON public.reconciliation_reports TO service_role;
ALTER TABLE public.reconciliation_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage reconciliation reports" ON public.reconciliation_reports
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));

CREATE TRIGGER update_reconciliation_reports_updated_at
  BEFORE UPDATE ON public.reconciliation_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reconciliation_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reconciliation_reports(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category text NOT NULL,
  source text NOT NULL,
  source_id uuid,
  item_date date,
  description text,
  reference text,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  exception_status text NOT NULL DEFAULT 'unreviewed',
  explanation text,
  reviewer_comment text,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, source, source_id)
);

CREATE INDEX idx_recon_report_items_report ON public.reconciliation_report_items(report_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_report_items TO authenticated;
GRANT ALL ON public.reconciliation_report_items TO service_role;
ALTER TABLE public.reconciliation_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members manage reconciliation report items" ON public.reconciliation_report_items
  FOR ALL TO authenticated
  USING (private.is_company_member(company_id))
  WITH CHECK (private.is_company_member(company_id));

CREATE TRIGGER update_reconciliation_report_items_updated_at
  BEFORE UPDATE ON public.reconciliation_report_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.reconciliation_report_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reconciliation_reports(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_email text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recon_report_audit_report ON public.reconciliation_report_audit(report_id);

GRANT SELECT, INSERT ON public.reconciliation_report_audit TO authenticated;
GRANT ALL ON public.reconciliation_report_audit TO service_role;
ALTER TABLE public.reconciliation_report_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read reconciliation report audit" ON public.reconciliation_report_audit
  FOR SELECT TO authenticated USING (private.is_company_member(company_id));
CREATE POLICY "members write reconciliation report audit" ON public.reconciliation_report_audit
  FOR INSERT TO authenticated WITH CHECK (private.is_company_member(company_id));

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS report_tolerance numeric NOT NULL DEFAULT 0.01;