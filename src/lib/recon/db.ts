import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// The generated Database types don't include these tables yet; use a loose
// client so queries stay ergonomic while RLS still scopes every read/write.
export const db = supabase as unknown as SupabaseClient<any, "public", any>;
export { supabase };

export type Company = { id: string; name: string; currency: string };

export type Profile = {
  id: string;
  email: string;
};

export type CompanyMember = {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export type CompanyInvite = {
  id: string;
  company_id: string;
  email: string;
  role: string;
  invited_by: string;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired" | string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

export type BankAccount = {
  id: string;
  company_id: string | null;
  bank_name: string;
  account_number: string;
  account_name?: string | null;
  currency?: string;
  opening_balance_statement?: number;
  opening_balance_ledger?: number;
  opening_balance_date?: string | null;
};

export type BankAccountCompany = {
  id: string;
  bank_account_id: string;
  company_id: string;
};

export type DataSet = {
  id: string;
  company_id: string;
  bank_account_id: string;
  source: "bank" | "ledger" | string;
  period_start: string | null;
  period_end: string | null;
  label: string;
  row_count: number;
  created_by_email: string | null;
  upload_timestamp: string;
  created_at: string;
};

export type OpenItem = {
  id: string;
  company_id: string;
  bank_account_id: string;
  source: "bank" | "ledger" | string;
  as_at_date: string;
  doc_ref: string | null;
  amount: number;
  direction: string;
  party_name: string | null;
  narration: string | null;
  status: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type AccountingRecord = {
  id: string;
  company_id: string;
  doc_type: string | null;
  doc_number: string;
  party_name: string | null;
  party_type: string | null;
  amount: number;
  balance: number | null;
  doc_date: string | null;
  side: string;
  status?: string;
  bank_account_id?: string | null;
  data_set_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  import_batch_id?: string | null;
  match_group_id?: string | null;
  reconciled_txn_id?: string | null;
  resolved_by_email?: string | null;
  resolved_at?: string | null;
  meta: Record<string, unknown>;
};

export type Category = "auto" | "review" | "unmatched" | "highvalue" | "duplicate" | "aging";

export type BankTransaction = {
  id: string;
  company_id: string;
  bank_account_id: string;
  txn_ref: string;
  amount: number;
  direction: string;
  txn_date: string | null;
  value_date: string | null;
  balance: number | null;
  narration: string | null;
  status: string;
  category: Category | null;
  ai_confidence: number | null;
  reconciled_record_id: string | null;
  resolved_by_email: string | null;
  resolved_at: string | null;
  rejection_reason?: string | null;
  manually_reconciled: boolean;

  data_set_id?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  import_batch_id?: string | null;
  match_group_id?: string | null;
  meta: Record<string, unknown>;
};

export type MatchSuggestion = {
  id: string;
  company_id: string;
  bank_transaction_id: string;
  accounting_record_id: string | null;
  confidence: number;
  amount_score: number;
  reference_score: number;
  date_score: number;
  party_score: number;
  side_score: number;
  status: string;
  rejection_reason?: string | null;
};

export type ImportBatch = {
  id: string;
  company_id: string;
  bank_account_id: string | null;
  source: "bank" | "ledger" | string;
  label: string;
  row_count: number;
  created_by_email: string | null;
  created_at: string;
};

export type MatchGroup = {
  id: string;
  company_id: string;
  bank_transaction_ids: string[];
  accounting_record_ids: string[];
  bank_total: number;
  ledger_total: number;
  difference: number;
  note: string | null;
  status: string;
  created_by_email: string | null;
  created_at: string;
};
