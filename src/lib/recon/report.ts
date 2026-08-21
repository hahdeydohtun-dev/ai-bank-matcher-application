import { db } from "./db";
import type { AccountingRecord, BankAccount, BankTransaction } from "./db";

export type ReportCategory =
  | "ledger_debits_not_in_bank"
  | "ledger_credits_not_in_bank"
  | "bank_credits_not_in_ledger"
  | "bank_debits_not_in_ledger";

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  ledger_debits_not_in_bank: "Ledger debits not in bank statement (deposits in transit)",
  ledger_credits_not_in_bank: "Ledger credits not in bank statement (unpresented payments)",
  bank_credits_not_in_ledger: "Bank credits not in ledger (unrecorded receipts)",
  bank_debits_not_in_ledger: "Bank debits not in ledger (charges / unrecorded payments)",
};

export type ReportItem = {
  id?: string;
  category: ReportCategory;
  source: "bank" | "ledger";
  source_id: string;
  item_date: string | null;
  description: string;
  reference: string;
  amount: number;
  notes?: string | null;
  exception_status?: string;
  explanation?: string | null;
  reviewer_comment?: string | null;
  excluded?: boolean;
};

export type ReconciliationReport = {
  id?: string;
  company_id: string;
  bank_account_id: string;
  reconciliation_id: string;
  version: number;
  period_start: string | null;
  period_end: string | null;
  as_of_date: string;
  currency: string;
  bank_statement_balance: number;
  gl_balance: number;
  ledger_debits_not_in_bank: number;
  ledger_credits_not_in_bank: number;
  bank_credits_not_in_ledger: number;
  bank_debits_not_in_ledger: number;
  adjusted_bank_balance: number;
  adjusted_book_balance: number;
  unreconciled_difference: number;
  tolerance: number;
  matched_count: number;
  bank_txn_count: number;
  ledger_txn_count: number;
  status: string;
  change_reason?: string | null;
  prepared_by?: string | null;
  prepared_at?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  finalized_by?: string | null;
  finalized_at?: string | null;
};

const SETTLED = new Set(["reconciled", "matched", "closed"]);

function inPeriod(date: string | null, start: string, end: string) {
  if (!date) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export function newReconciliationId() {
  const year = new Date().getFullYear();
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `REC-${year}-${suffix}`;
}

/**
 * Builds the accounting view of a reconciliation: every still-unmatched bank
 * line and ledger entry is classified into one of the four reconciling
 * buckets, then the statement and book balances are adjusted towards each
 * other. A clean reconciliation ends with a difference inside tolerance.
 */
export function buildReport(input: {
  companyId: string;
  account: BankAccount;
  currency: string;
  transactions: BankTransaction[];
  records: AccountingRecord[];
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  tolerance: number;
  reconciliationId?: string;
  version?: number;
  preparedBy?: string | null;
}): { report: ReconciliationReport; items: ReportItem[] } {
  const {
    companyId,
    account,
    currency,
    periodStart,
    periodEnd,
    asOfDate,
    tolerance,
  } = input;

  const txns = input.transactions.filter(
    (t) => t.bank_account_id === account.id && inPeriod(t.txn_date, periodStart, periodEnd),
  );
  const recs = input.records.filter(
    (r) =>
      (!r.bank_account_id || r.bank_account_id === account.id) &&
      inPeriod(r.doc_date ?? null, periodStart, periodEnd),
  );

  const openingBank = Number(account.opening_balance_statement ?? 0);
  const openingBook = Number(account.opening_balance_ledger ?? 0);

  const bankMovement = txns.reduce(
    (sum, t) => sum + (t.direction === "credit" ? Number(t.amount) : -Number(t.amount)),
    0,
  );
  const bookMovement = recs.reduce(
    (sum, r) => sum + (r.side === "debit" ? Number(r.amount) : -Number(r.amount)),
    0,
  );

  const bankStatementBalance = openingBank + bankMovement;
  const glBalance = openingBook + bookMovement;

  const items: ReportItem[] = [];

  for (const t of txns) {
    if (SETTLED.has(t.status)) continue;
    items.push({
      category: t.direction === "credit" ? "bank_credits_not_in_ledger" : "bank_debits_not_in_ledger",
      source: "bank",
      source_id: t.id,
      item_date: t.txn_date,
      description: t.narration ?? "Bank transaction",
      reference: t.txn_ref,
      amount: Number(t.amount),
    });
  }

  for (const r of recs) {
    if (SETTLED.has(r.status ?? "")) continue;
    items.push({
      category: r.side === "debit" ? "ledger_debits_not_in_bank" : "ledger_credits_not_in_bank",
      source: "ledger",
      source_id: r.id,
      item_date: r.doc_date,
      description: r.party_name ?? r.doc_type ?? "Ledger entry",
      reference: r.doc_number,
      amount: Number(r.amount),
    });
  }

  const total = (category: ReportCategory) =>
    items
      .filter((i) => i.category === category && !i.excluded)
      .reduce((sum, i) => sum + i.amount, 0);

  const ledgerDebits = total("ledger_debits_not_in_bank");
  const ledgerCredits = total("ledger_credits_not_in_bank");
  const bankCredits = total("bank_credits_not_in_ledger");
  const bankDebits = total("bank_debits_not_in_ledger");

  const adjustedBank = bankStatementBalance + ledgerDebits - ledgerCredits;
  const adjustedBook = glBalance + bankCredits - bankDebits;

  const report: ReconciliationReport = {
    company_id: companyId,
    bank_account_id: account.id,
    reconciliation_id: input.reconciliationId ?? newReconciliationId(),
    version: input.version ?? 1,
    period_start: periodStart || null,
    period_end: periodEnd || null,
    as_of_date: asOfDate,
    currency,
    bank_statement_balance: bankStatementBalance,
    gl_balance: glBalance,
    ledger_debits_not_in_bank: ledgerDebits,
    ledger_credits_not_in_bank: ledgerCredits,
    bank_credits_not_in_ledger: bankCredits,
    bank_debits_not_in_ledger: bankDebits,
    adjusted_bank_balance: adjustedBank,
    adjusted_book_balance: adjustedBook,
    unreconciled_difference: adjustedBank - adjustedBook,
    tolerance,
    matched_count: txns.filter((t) => SETTLED.has(t.status)).length,
    bank_txn_count: txns.length,
    ledger_txn_count: recs.length,
    status: "generated",
    prepared_by: input.preparedBy ?? null,
  };

  return { report, items };
}

export async function saveReport(
  report: ReconciliationReport,
  items: ReportItem[],
  actorEmail: string | null,
  reason?: string,
) {
  const { data, error } = await db
    .from("reconciliation_reports")
    .insert(report)
    .select("*")
    .single();
  if (error) throw error;
  const saved = data as ReconciliationReport & { id: string };

  if (items.length) {
    const { error: itemErr } = await db.from("reconciliation_report_items").insert(
      items.map((i) => ({
        ...i,
        id: undefined,
        report_id: saved.id,
        company_id: report.company_id,
      })),
    );
    if (itemErr) throw itemErr;
  }

  await logReportAudit(saved.id, report.company_id, "generated", actorEmail, reason, {
    unreconciled_difference: report.unreconciled_difference,
  });

  return saved;
}

export async function logReportAudit(
  reportId: string | null,
  companyId: string,
  action: string,
  actorEmail: string | null,
  reason?: string | null,
  newValue?: Record<string, unknown> | null,
  previousValue?: Record<string, unknown> | null,
) {
  await db.from("reconciliation_report_audit").insert({
    report_id: reportId,
    company_id: companyId,
    action,
    actor_email: actorEmail,
    reason: reason ?? null,
    new_value: newValue ?? null,
    previous_value: previousValue ?? null,
  });
}

export async function loadReports(companyId: string, accountId?: string) {
  let query = db
    .from("reconciliation_reports")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (accountId) query = query.eq("bank_account_id", accountId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as (ReconciliationReport & { id: string; created_at: string })[];
}

export async function loadReportItems(reportId: string) {
  const { data, error } = await db
    .from("reconciliation_report_items")
    .select("*")
    .eq("report_id", reportId)
    .order("item_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as (ReportItem & { id: string })[];
}

export async function nextVersion(companyId: string, reconciliationId: string) {
  const { data } = await db
    .from("reconciliation_reports")
    .select("version")
    .eq("company_id", companyId)
    .eq("reconciliation_id", reconciliationId)
    .order("version", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as { version: number }[];
  return (rows[0]?.version ?? 0) + 1;
}

export async function setReportStatus(
  report: ReconciliationReport & { id: string },
  status: "reviewed" | "approved" | "finalized",
  actorEmail: string | null,
  reason?: string,
) {
  const stamp = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "reviewed") {
    patch.reviewed_by = actorEmail;
    patch.reviewed_at = stamp;
  } else if (status === "approved") {
    patch.approved_by = actorEmail;
    patch.approved_at = stamp;
  } else {
    patch.finalized_by = actorEmail;
    patch.finalized_at = stamp;
  }
  if (reason) patch.change_reason = reason;
  const { error } = await db
    .from("reconciliation_reports")
    .update(patch)
    .eq("id", report.id);
  if (error) throw error;
  await logReportAudit(report.id, report.company_id, status, actorEmail, reason, patch);
}
