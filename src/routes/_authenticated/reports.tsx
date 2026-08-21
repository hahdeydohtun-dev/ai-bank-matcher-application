import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db, supabase, type AccountingRecord, type BankAccount, type BankTransaction, type Company } from "@/lib/recon/db";
import { useSettings } from "@/lib/recon/settings";
import { formatAmount, formatDate } from "@/lib/recon/format";
import {
  buildReport,
  CATEGORY_LABEL,
  loadReportItems,
  loadReports,
  logReportAudit,
  nextVersion,
  saveReport,
  setReportStatus,
  type ReconciliationReport,
  type ReportCategory,
  type ReportItem,
} from "@/lib/recon/report";
import { exportReportCsv, exportReportExcel, exportReportPdf } from "@/lib/recon/reportExport";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Bank Reconciliation Report" },
      {
        name: "description",
        content:
          "Generate, review and export formal bank reconciliation statements with adjusted bank and book balances.",
      },
      { property: "og:title", content: "Bank Reconciliation Report" },
      {
        property: "og:description",
        content: "Audit-ready bank reconciliation statements with Excel, PDF and CSV export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportsPage,
});

const ORDER: ReportCategory[] = [
  "ledger_debits_not_in_bank",
  "ledger_credits_not_in_bank",
  "bank_credits_not_in_ledger",
  "bank_debits_not_in_ledger",
];

type SavedReport = ReconciliationReport & { id: string; created_at?: string };

function ReportsPage() {
  const [email, setEmail] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [settings] = useSettings(companyId);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState("");

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tolerance, setTolerance] = useState(0.01);

  const [history, setHistory] = useState<SavedReport[]>([]);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [items, setItems] = useState<(ReportItem & { id?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const currency = account?.currency || company?.currency || "NGN";

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    void db
      .from("companies")
      .select("*")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Company[];
        setCompanies(list);
        const last = typeof window !== "undefined" ? localStorage.getItem("recon.lastCompany") : null;
        setCompanyId((prev) => prev || list.find((c) => c.id === last)?.id || list[0]?.id || "");
      });
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void Promise.all([
      db.from("bank_accounts").select("*"),
      db.from("bank_account_companies").select("bank_account_id").eq("company_id", companyId),
    ]).then(([allRes, linkRes]) => {
      if (cancelled) return;
      const linked = new Set(
        ((linkRes.data ?? []) as { bank_account_id: string }[]).map((r) => r.bank_account_id),
      );
      const list = ((allRes.data ?? []) as BankAccount[]).filter((a) => linked.has(a.id));
      setAccounts(list);
      setAccountId((prev) => (list.some((a) => a.id === prev) ? prev : (list[0]?.id ?? "")));
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    setTolerance(Number((settings as unknown as { reportTolerance?: number }).reportTolerance ?? 0.01));
  }, [settings]);

  const refreshHistory = useCallback(async () => {
    if (!companyId) return;
    try {
      setHistory((await loadReports(companyId, accountId || undefined)) as SavedReport[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load report history");
    }
  }, [companyId, accountId]);

  useEffect(() => {
    void refreshHistory();
    setReport(null);
    setItems([]);
  }, [refreshHistory]);

  async function generate(newVersionOf?: SavedReport) {
    if (!companyId || !account) {
      toast.error("Pick a company and bank account first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const PAGE = 1000;
      async function fetchAll<T>(table: string, dateCol: string): Promise<T[]> {
        const out: T[] = [];
        for (let page = 0; ; page += 1) {
          const { data, error: err } = await db
            .from(table)
            .select("*")
            .eq("company_id", companyId)
            .eq("bank_account_id", account!.id)
            .order(dateCol, { ascending: true })
            .range(page * PAGE, page * PAGE + PAGE - 1);
          if (err) throw err;
          const chunk = (data ?? []) as T[];
          out.push(...chunk);
          if (chunk.length < PAGE) return out;
        }
      }
      const [txns, recs] = await Promise.all([
        fetchAll<BankTransaction>("bank_transactions", "txn_date"),
        fetchAll<AccountingRecord>("accounting_records", "doc_date"),
      ]);

      const version = newVersionOf
        ? await nextVersion(companyId, newVersionOf.reconciliation_id)
        : 1;
      const { report: draft, items: draftItems } = buildReport({
        companyId,
        account,
        currency,
        transactions: txns,
        records: recs,
        periodStart,
        periodEnd,
        asOfDate,
        tolerance,
        reconciliationId: newVersionOf?.reconciliation_id,
        version,
        preparedBy: email,
      });
      const saved = (await saveReport(draft, draftItems, email)) as SavedReport;
      setReport(saved);
      setItems(await loadReportItems(saved.id));
      await refreshHistory();
      toast.success(`Report ${saved.reconciliation_id} v${saved.version} generated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function open(r: SavedReport) {
    setBusy(true);
    try {
      setReport(r);
      setItems(await loadReportItems(r.id));
      await logReportAudit(r.id, r.company_id, "viewed", email);
    } finally {
      setBusy(false);
    }
  }

  async function advance(status: "reviewed" | "approved" | "finalized") {
    if (!report) return;
    const reason =
      status === "finalized"
        ? (window.prompt("Reason / note for finalising this reconciliation?") ?? undefined)
        : undefined;
    try {
      await setReportStatus(report, status, email, reason);
      toast.success(`Report marked ${status}.`);
      const fresh = { ...report, status } as SavedReport;
      setReport(fresh);
      await refreshHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update report");
    }
  }

  const ctx = useMemo(
    () =>
      report && account
        ? {
            companyName: company?.name ?? "",
            bankName: account.bank_name,
            accountName: account.account_name ?? "",
            accountNumber: account.account_number,
            report,
            items,
          }
        : null,
    [report, account, company, items],
  );

  async function doExport(kind: "xlsx" | "pdf" | "csv") {
    if (!ctx || !report) return;
    try {
      if (kind === "xlsx") await exportReportExcel(ctx);
      else if (kind === "pdf") await exportReportPdf(ctx);
      else exportReportCsv(ctx);
      await logReportAudit(report.id, report.company_id, `exported_${kind}`, email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  }

  const balanced = report ? Math.abs(report.unreconciled_difference) <= report.tolerance : false;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="caption">Accounting → Bank Reconciliation Report</p>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="mono">{email}</span>
            <Link
              to="/reconciliation"
              className="rounded-md border border-border-strong px-2 py-1 hover:border-primary hover:text-primary"
            >
              Workspace
            </Link>
            <Link
              to="/control-panel"
              className="rounded-md border border-border-strong px-2 py-1 hover:border-primary hover:text-primary"
            >
              Control panel
            </Link>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-5">
        <h1 className="text-2xl font-semibold tracking-tight">Bank Reconciliation Report</h1>

        {error && (
          <div className="panel border-destructive/50 px-3 py-2 text-xs text-destructive">{error}</div>
        )}

        {/* selectors */}
        <div className="panel grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1 text-xs">
            <span className="caption">Company</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="caption">Bank account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank_name} · {a.account_number}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="caption">Period start</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="caption">Period end</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="caption">As-of date</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="caption">Tolerance ({currency})</span>
            <input
              type="number"
              step="0.01"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="w-full rounded-md border border-border-strong bg-background px-2 py-1.5"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Working…" : "Generate report"}
          </button>
          {report && (
            <>
              <button
                onClick={() => void generate(report)}
                disabled={busy}
                className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Regenerate as v{report.version + 1}
              </button>
              <button
                onClick={() => void doExport("xlsx")}
                className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold"
              >
                Export Excel
              </button>
              <button
                onClick={() => void doExport("pdf")}
                className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold"
              >
                Export PDF
              </button>
              <button
                onClick={() => void doExport("csv")}
                className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold"
              >
                Export CSV
              </button>
              <button
                onClick={() => {
                  void logReportAudit(report.id, report.company_id, "printed", email);
                  window.print();
                }}
                className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold"
              >
                Print
              </button>
              {(["reviewed", "approved", "finalized"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => void advance(s)}
                  disabled={report.status === "finalized"}
                  className="rounded-md border border-border-strong px-3 py-2 text-xs font-semibold capitalize disabled:opacity-50"
                >
                  Mark {s}
                </button>
              ))}
            </>
          )}
        </div>

        {report && (
          <div className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {company?.name} — Bank Reconciliation Statement
                </h2>
                <p className="text-xs text-muted-foreground">
                  {account?.bank_name} · {account?.account_number} ·{" "}
                  {report.reconciliation_id} v{report.version} · as of {formatDate(report.as_of_date)}
                </p>
              </div>
              <span
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                  balanced
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
              >
                {balanced ? "Balanced" : "Out of balance"} ·{" "}
                {formatAmount(report.unreconciled_difference, currency)}
              </span>
            </div>

            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2 font-semibold">Balance per bank statement</td>
                  <td className="mono py-2 text-right font-semibold">
                    {formatAmount(report.bank_statement_balance, currency)}
                  </td>
                </tr>
                {ORDER.map((category) => {
                  const rows = items.filter((i) => i.category === category && !i.excluded);
                  const sum = rows.reduce((s, i) => s + Number(i.amount), 0);
                  return (
                    <>
                      <tr key={category} className="bg-muted/40">
                        <td className="py-2 font-semibold" colSpan={2}>
                          {CATEGORY_LABEL[category]}
                        </td>
                      </tr>
                      {rows.map((i) => (
                        <tr key={i.id ?? i.source_id} className="border-b border-border/50">
                          <td className="py-1.5 pl-4">
                            <span className="mono text-muted-foreground">
                              {formatDate(i.item_date)}
                            </span>{" "}
                            {i.description}{" "}
                            <span className="mono text-muted-foreground">{i.reference}</span>
                          </td>
                          <td className="mono py-1.5 text-right">
                            {formatAmount(i.amount, currency)}
                          </td>
                        </tr>
                      ))}
                      {!rows.length && (
                        <tr key={`${category}-empty`}>
                          <td className="py-1.5 pl-4 text-muted-foreground" colSpan={2}>
                            No items
                          </td>
                        </tr>
                      )}
                      <tr key={`${category}-total`} className="border-b border-border">
                        <td className="py-1.5 pl-4 font-medium">Total</td>
                        <td className="mono py-1.5 text-right font-medium">
                          {formatAmount(sum, currency)}
                        </td>
                      </tr>
                    </>
                  );
                })}
                <tr className="border-b border-border">
                  <td className="py-2 font-semibold">Adjusted bank balance</td>
                  <td className="mono py-2 text-right font-semibold">
                    {formatAmount(report.adjusted_bank_balance, currency)}
                  </td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2">Balance per general ledger</td>
                  <td className="mono py-2 text-right">{formatAmount(report.gl_balance, currency)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 font-semibold">Adjusted book balance</td>
                  <td className="mono py-2 text-right font-semibold">
                    {formatAmount(report.adjusted_book_balance, currency)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold">Unreconciled difference</td>
                  <td
                    className={`mono py-2 text-right font-semibold ${
                      balanced ? "text-success" : "text-destructive"
                    }`}
                  >
                    {formatAmount(report.unreconciled_difference, currency)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
              <span>Prepared by: {report.prepared_by ?? "—"}</span>
              <span>Reviewed by: {report.reviewed_by ?? "—"}</span>
              <span>Approved by: {report.approved_by ?? "—"}</span>
            </div>
          </div>
        )}

        <div className="panel p-4">
          <p className="caption mb-2">Report history</p>
          {!history.length && <p className="text-xs text-muted-foreground">No reports yet.</p>}
          <div className="space-y-1">
            {history.map((r) => (
              <button
                key={r.id}
                onClick={() => void open(r)}
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs hover:border-primary ${
                  report?.id === r.id ? "border-primary" : "border-border"
                }`}
              >
                <span className="mono">
                  {r.reconciliation_id} v{r.version}
                </span>
                <span className="text-muted-foreground">as of {formatDate(r.as_of_date)}</span>
                <span className="capitalize text-muted-foreground">{r.status}</span>
                <span className="mono">
                  {formatAmount(r.unreconciled_difference, r.currency)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
