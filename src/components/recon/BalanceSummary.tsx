import { useMemo } from "react";
import type { AccountingRecord, BankAccount, BankTransaction } from "@/lib/recon/db";
import { buildReport } from "@/lib/recon/report";
import { formatAmount } from "@/lib/recon/format";

export function BalanceSummary({ companyId, account, currency, transactions, records, fromDate, toDate, loading }: {
  companyId: string; account: BankAccount | null; currency: string; transactions: BankTransaction[]; records: AccountingRecord[]; fromDate: string; toDate: string; loading: boolean;
}) {
  const report = useMemo(() => account ? buildReport({ companyId, account, currency, transactions, records, periodStart: fromDate, periodEnd: toDate, asOfDate: toDate, tolerance: 0, reconciliationId: "workspace" }).report : null,
    [companyId, account, currency, transactions, records, fromDate, toDate]);
  const difference = report ? report.bank_statement_balance - report.gl_balance : null;
  return <section aria-label="Reconciliation balances" className="grid gap-3 border-y border-border bg-surface px-4 py-3 sm:grid-cols-3">
    <div><p className="caption">Closing balance · bank statement</p><p className="mono mt-1 text-base font-semibold">{!loading && report ? formatAmount(report.bank_statement_balance, currency) : "—"}</p></div>
    <div><p className="caption">Closing balance · ERP / general ledger</p><p className="mono mt-1 text-base font-semibold">{!loading && report ? formatAmount(report.gl_balance, currency) : "—"}</p></div>
    <div><p className="caption">Difference · bank minus ERP</p><p className={`mono mt-1 text-base font-semibold ${difference === 0 ? "text-success" : "text-destructive"}`}>{!loading && difference !== null ? formatAmount(difference, currency) : "—"}</p></div>
  </section>;
}