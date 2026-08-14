import { useEffect, useMemo, useRef, useState } from "react";
import { db, type BankAccount, type Company, type OpenItem } from "@/lib/recon/db";
import { parseCsv } from "@/lib/recon/csv";
import {
  OPEN_ITEM_BANK_HEADERS,
  OPEN_ITEM_LEDGER_HEADERS,
  OPEN_ITEM_BANK_REQUIRED,
  OPEN_ITEM_LEDGER_REQUIRED,
  missingRequiredHeaders,
  openItemsTemplateCsv,
  openItemsToCsv,
  parseOpenItemsCsv,
  parseOpenItemsHeaders,
  type OpenItemCsvRow,
} from "@/lib/recon/openItemsCsv";
import { downloadCsv } from "@/lib/recon/bankAccountCsv";

type LinkRow = { bank_account_id: string; company_id: string };

export function OpeningBalancesTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);

  const [stmt, setStmt] = useState("0");
  const [led, setLed] = useState("0");
  const [asAt, setAsAt] = useState("");

  const [uploadSource, setUploadSource] = useState<"bank" | "ledger">("bank");
  const [uploadAsAt, setUploadAsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    active: boolean;
    source: "bank" | "ledger" | null;
    total: number;
    processed: number;
    inserted: number;
    rejected: number;
    startedAt: number;
    finishedAt: number | null;
    errors: string[];
  }>({
    active: false,
    source: null,
    total: 0,
    processed: 0,
    inserted: 0,
    rejected: 0,
    startedAt: 0,
    finishedAt: null,
    errors: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "bank" | "ledger">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "debit" | "credit">("all");
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewStatus, setPreviewStatus] = useState<"all" | "valid" | "invalid">("all");

  const [lastUpload, setLastUpload] = useState<{
    source: "bank" | "ledger";
    filename: string;
    text: string;
    at: string;
  } | null>(null);

  type ImportStat = {
    filename: string;
    at: string;
    parsed: number;
    newValid: number;
    invalid: number;
    imported: number;
  };
  const [importStats, setImportStats] = useState<{
    bank: ImportStat | null;
    ledger: ImportStat | null;
  }>({ bank: null, ledger: null });

  type RejectedReport = {
    filename: string;
    at: string;
    headers: string[];
    rows: { index: number; error: string; cells: string[] }[];
  };
  const [lastRejected, setLastRejected] = useState<{
    bank: RejectedReport | null;
    ledger: RejectedReport | null;
  }>({ bank: null, ledger: null });

  type SavedImport = {
    filename: string;
    at: string;
    asAt: string;
    headers: string[];
    missing: string[];
    validCount: number;
    invalidCount: number;
    text: string;
  };
  const SAVED_KEY = "open-items:last-import";
  const [savedImports, setSavedImports] = useState<{
    bank: SavedImport | null;
    ledger: SavedImport | null;
  }>({ bank: null, ledger: null });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) setSavedImports(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const [preview, setPreview] = useState<{
    source: "bank" | "ledger";
    asAt: string;
    headers: string[];
    missing: string[];
    rows: OpenItemCsvRow[];
    filename: string;
    text: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const [cRes, aRes, lRes] = await Promise.all([
        db.from("companies").select("*").order("name"),
        db.from("bank_accounts").select("*").order("bank_name"),
        db.from("bank_account_companies").select("bank_account_id, company_id"),
      ]);
      setCompanies((cRes.data ?? []) as Company[]);
      setAccounts((aRes.data ?? []) as BankAccount[]);
      setLinks((lRes.data ?? []) as LinkRow[]);
    })();
  }, []);

  const availableAccounts = useMemo(() => {
    if (!companyId) return [] as BankAccount[];
    const ids = new Set(
      links.filter((l) => l.company_id === companyId).map((l) => l.bank_account_id),
    );
    return accounts.filter((a) => ids.has(a.id));
  }, [companyId, accounts, links]);

  useEffect(() => {
    setAccountId(availableAccounts[0]?.id ?? "");
  }, [availableAccounts]);

  const account = accounts.find((a) => a.id === accountId) ?? null;

  useEffect(() => {
    if (!account) return;
    setStmt(String(account.opening_balance_statement ?? 0));
    setLed(String(account.opening_balance_ledger ?? 0));
    setAsAt(account.opening_balance_date ?? "");
    setUploadAsAt(account.opening_balance_date ?? "");
  }, [account?.id]);

  async function loadOpenItems() {
    if (!companyId || !accountId) {
      setOpenItems([]);
      return;
    }
    const { data } = await db
      .from("open_items")
      .select("*")
      .eq("company_id", companyId)
      .eq("bank_account_id", accountId)
      .order("as_at_date", { ascending: false });
    setOpenItems((data ?? []) as OpenItem[]);
  }
  useEffect(() => {
    void loadOpenItems();
  }, [companyId, accountId]);

  async function saveBalances() {
    if (!account) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await db
        .from("bank_accounts")
        .update({
          opening_balance_statement: Number(stmt) || 0,
          opening_balance_ledger: Number(led) || 0,
          opening_balance_date: asAt || null,
        })
        .eq("id", account.id);
      if (err) throw err;
      setNotice("Opening balances saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    if (!companyId || !accountId) {
      setError("Pick a company and bank account first.");
      return;
    }
    if (!uploadAsAt) {
      setError("Set an 'as at' date for the open items.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const headers = parseOpenItemsHeaders(text);
      const missing = missingRequiredHeaders(headers, uploadSource);
      const rows = parseOpenItemsCsv(text, uploadSource, uploadAsAt);
      setPreview({
        source: uploadSource,
        asAt: uploadAsAt,
        headers,
        missing,
        rows,
        filename: file.name,
        text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
    } finally {
      setBusy(false);
    }
  }

  async function reimportSaved(side: "bank" | "ledger", options?: { autoConfirm?: boolean }) {
    const s = savedImports[side];
    if (!s) return;
    if (!companyId || !accountId) {
      setError("Pick a company and bank account first.");
      return;
    }
    // Re-parse and re-validate against the current templates so mapping and
    // errors reflect any code changes since the last save.
    const headers = parseOpenItemsHeaders(s.text);
    const missing = missingRequiredHeaders(headers, side);
    const rows = parseOpenItemsCsv(s.text, side, s.asAt);
    const nextPreview = {
      source: side,
      asAt: s.asAt,
      headers,
      missing,
      rows,
      filename: s.filename,
      text: s.text,
    };
    setUploadSource(side);
    setUploadAsAt(s.asAt);
    setPreview(nextPreview);
    setError(null);
    setNotice(null);
    if (options?.autoConfirm) {
      await confirmImport(nextPreview);
    }
  }



  async function confirmImport(override?: NonNullable<typeof preview>) {
    const p = override ?? preview;
    if (!p || !companyId || !accountId) return;

    // Capture rejected rows for the error report regardless of whether the
    // import proceeds — users can download the reasons even if headers are
    // missing or no valid rows remain.
    const parsedTable = parseCsv(p.text);
    const invalidRows = p.rows.filter((r) => !r.valid);
    const rejected: RejectedReport = {
      filename: p.filename,
      at: new Date().toISOString(),
      headers: parsedTable.headers,
      rows: invalidRows.map((r) => ({
        index: r.index,
        error: r.error ?? "Invalid row",
        // r.index is 1-based including header row → data row index = r.index - 2
        cells: parsedTable.rows[r.index - 2] ?? [],
      })),
    };
    // If required headers are missing, mark every data row as rejected with
    // the header reason so the error CSV explains the failure per row.
    if (p.missing.length) {
      const reason = `Missing required column(s): ${p.missing.join(", ")}`;
      rejected.rows = parsedTable.rows.map((cells, i) => ({
        index: i + 2,
        error: reason,
        cells,
      }));
    }
    setLastRejected((prev) => ({ ...prev, [p.source]: rejected }));

    if (p.missing.length) {
      setError(`Missing required column(s): ${p.missing.join(", ")}`);
      return;
    }
    const valid = p.rows.filter((r) => r.valid);
    if (!valid.length) {
      setError("No valid rows to import.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const invalidCount = p.rows.filter((r) => !r.valid).length;
    setProgress({
      active: true,
      source: p.source,
      total: p.rows.length,
      processed: invalidCount,
      inserted: 0,
      rejected: invalidCount,
      startedAt: Date.now(),
      finishedAt: null,
      errors: [],
    });
    const BATCH_SIZE = 500;
    let inserted = 0;
    let rejectCount = invalidCount;
    const errors: string[] = [];
    try {
      const payload = valid.map((r) => ({
        company_id: companyId,
        bank_account_id: accountId,
        source: p.source,
        as_at_date: r.values.as_at_date,
        doc_ref: r.values.doc_ref || null,
        amount: r.values.amount,
        direction: r.values.direction,
        party_name: r.values.party_name || null,
        narration: r.values.narration || null,
        meta: r.values.meta ?? {},
      }));
      for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        const chunk = payload.slice(i, i + BATCH_SIZE);
        const { error: err } = await db.from("open_items").insert(chunk);
        if (err) {
          rejectCount += chunk.length;
          errors.push(
            `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`,
          );
        } else {
          inserted += chunk.length;
        }
        setProgress((prev) => ({
          ...prev,
          processed: invalidCount + i + chunk.length,
          inserted,
          rejected: rejectCount,
          errors: [...errors],
        }));
        // Yield to the event loop so the progress bar can paint on large files.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (errors.length && inserted === 0) {
        throw new Error(errors[0]);
      }
      setNotice(
        errors.length
          ? `Imported ${inserted} of ${valid.length} ${p.source} open item(s); ${rejectCount - invalidCount} failed to insert.`
          : `Imported ${inserted} ${p.source} open item(s).`,
      );
      setLastUpload({
        source: p.source,
        filename: p.filename,
        text: p.text,
        at: new Date().toISOString(),
      });
      setImportStats((prev) => ({
        ...prev,
        [p.source]: {
          filename: p.filename,
          at: new Date().toISOString(),
          parsed: p.rows.length,
          newValid: valid.length,
          invalid: invalidCount,
          imported: inserted,
        },
      }));
      const saved: SavedImport = {
        filename: p.filename,
        at: new Date().toISOString(),
        asAt: p.asAt,
        headers: p.headers,
        missing: p.missing,
        validCount: valid.length,
        invalidCount,
        text: p.text,
      };
      setSavedImports((prev) => {
        const next = { ...prev, [p.source]: saved };
        try {
          localStorage.setItem(SAVED_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      setPreview(null);
      await loadOpenItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      setProgress((prev) => ({
        ...prev,
        active: false,
        finishedAt: Date.now(),
        inserted,
        rejected: rejectCount,
        processed: prev.total,
        errors,
      }));
    }
  }



  async function removeOpenItem(id: string) {
    await db.from("open_items").delete().eq("id", id);
    await loadOpenItems();
  }

  const filteredOpenItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return openItems.filter((o) => {
      if (dateFrom && o.as_at_date < dateFrom) return false;
      if (dateTo && o.as_at_date > dateTo) return false;
      if (sideFilter !== "all" && o.source !== sideFilter) return false;
      if (directionFilter !== "all" && o.direction !== directionFilter) return false;
      if (q) {
        const meta = (o.meta ?? {}) as Record<string, unknown>;
        const narration =
          (o.narration as string | undefined) ??
          (meta.Remarks as string | undefined) ??
          "";
        const hay = [
          o.doc_ref ?? "",
          o.party_name ?? "",
          narration,
          (meta.Account as string) ?? "",
          (meta.Voucher_Type as string) ?? "",
          (meta.Supplier_Invoice_No as string) ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [openItems, dateFrom, dateTo, sideFilter, directionFilter, search]);

  function exportOpenItems(source: "bank" | "ledger") {
    if (!companyId || !accountId) return;
    const items = filteredOpenItems
      .filter((o) => o.source === source)
      .map((o) => ({
        source: o.source as "bank" | "ledger",
        as_at_date: o.as_at_date,
        doc_ref: o.doc_ref,
        amount: Number(o.amount) || 0,
        direction: (o.direction === "credit" ? "credit" : "debit") as
          | "debit"
          | "credit",
        party_name: o.party_name,
        narration: o.narration,
        meta: (o.meta ?? {}) as Record<string, unknown>,
      }));
    const csv = openItemsToCsv(source, items);
    const company = companies.find((c) => c.id === companyId);
    const acct = accounts.find((a) => a.id === accountId);
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const parts = [
      "open-items",
      source,
      company ? slug(company.name) : "",
      acct ? slug(`${acct.bank_name}-${acct.account_number}`) : "",
      dateFrom || "",
      dateTo || "",
    ].filter(Boolean);
    downloadCsv(`${parts.join("_")}.csv`, csv);
  }

  function csvEscape(v: unknown): string {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadImportSummary() {
    const company = companies.find((c) => c.id === companyId);
    const acct = accounts.find((a) => a.id === accountId);
    const bankExisting = filteredOpenItems.filter((o) => o.source === "bank").length;
    const ledgerExisting = filteredOpenItems.filter((o) => o.source === "ledger").length;
    const headers = [
      "side",
      "company",
      "bank_account",
      "date_from",
      "date_to",
      "existing_open_items_in_range",
      "last_upload_filename",
      "last_upload_at",
      "rows_parsed",
      "new_rows",
      "invalid_rows",
      "imported_rows",
    ];
    const rowFor = (side: "bank" | "ledger", existing: number) => {
      const s = importStats[side];
      return [
        side,
        company?.name ?? "",
        acct ? `${acct.bank_name} ${acct.account_number}` : "",
        dateFrom,
        dateTo,
        existing,
        s?.filename ?? "",
        s?.at ?? "",
        s?.parsed ?? 0,
        s?.newValid ?? 0,
        s?.invalid ?? 0,
        s?.imported ?? 0,
      ];
    };
    const lines = [
      headers.join(","),
      rowFor("bank", bankExisting).map(csvEscape).join(","),
      rowFor("ledger", ledgerExisting).map(csvEscape).join(","),
    ];
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const parts = [
      "open-items-summary",
      company ? slug(company.name) : "",
      acct ? slug(`${acct.bank_name}-${acct.account_number}`) : "",
      dateFrom || "",
      dateTo || "",
    ].filter(Boolean);
    downloadCsv(`${parts.join("_")}.csv`, lines.join("\n") + "\n");
  }

  function downloadLastUpload() {
    if (!lastUpload) return;
    downloadCsv(lastUpload.filename || "open-items-upload.csv", lastUpload.text);
  }

  function downloadErrorReport(side: "bank" | "ledger") {
    const rep = lastRejected[side];
    if (!rep || !rep.rows.length) return;
    const headers = ["row_number", "error_reason", ...rep.headers];
    const lines = [headers.map(csvEscape).join(",")];
    for (const r of rep.rows) {
      const row = [r.index, r.error, ...rep.headers.map((_, i) => r.cells[i] ?? "")];
      lines.push(row.map(csvEscape).join(","));
    }
    const company = companies.find((c) => c.id === companyId);
    const acct = accounts.find((a) => a.id === accountId);
    const slug = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const parts = [
      "open-items-errors",
      side,
      company ? slug(company.name) : "",
      acct ? slug(`${acct.bank_name}-${acct.account_number}`) : "",
    ].filter(Boolean);
    downloadCsv(`${parts.join("_")}.csv`, lines.join("\n") + "\n");
  }


  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Opening balances & open items</h2>
        <p className="text-xs text-muted-foreground">
          Prior-period position for a company + bank account. Open items are carried into the
          next period automatically.
        </p>
      </div>

      <div className="panel grid gap-3 p-3 sm:grid-cols-2">
        <div>
          <label className="caption">Company</label>
          <select
            className="field mt-1"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">— select —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="caption">Bank account</label>
          <select
            className="field mt-1"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={!companyId}
          >
            <option value="">— select —</option>
            {availableAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name} · {a.account_number}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          {notice}
        </p>
      )}

      {account && (
        <>
          <div className="panel p-4">
            <p className="caption">Opening balances</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="caption">As at date</label>
                <input
                  type="date"
                  className="field mt-1"
                  value={asAt}
                  onChange={(e) => setAsAt(e.target.value)}
                />
              </div>
              <div>
                <label className="caption">Bank statement</label>
                <input
                  type="number"
                  className="field mt-1"
                  value={stmt}
                  onChange={(e) => setStmt(e.target.value)}
                />
              </div>
              <div>
                <label className="caption">Ledger</label>
                <input
                  type="number"
                  className="field mt-1"
                  value={led}
                  onChange={(e) => setLed(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void saveBalances()}
                disabled={busy}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save balances"}
              </button>
            </div>
          </div>

          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="caption">Upload open items</p>
                <p className="text-xs text-muted-foreground">
                  Unreconciled transactions carried from a prior period.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    downloadCsv(
                      "open-items-bank-template.csv",
                      openItemsTemplateCsv("bank"),
                    )
                  }
                  className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
                >
                  Download bank template
                </button>
                <button
                  onClick={() =>
                    downloadCsv(
                      "open-items-ledger-template.csv",
                      openItemsTemplateCsv("ledger"),
                    )
                  }
                  className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
                >
                  Download ledger template
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="caption">Side</label>
                <select
                  className="field mt-1"
                  value={uploadSource}
                  onChange={(e) => setUploadSource(e.target.value as "bank" | "ledger")}
                >
                  <option value="bank">Bank statement</option>
                  <option value="ledger">Ledger</option>
                </select>
              </div>
              <div>
                <label className="caption">As at date</label>
                <input
                  type="date"
                  className="field mt-1"
                  value={uploadAsAt}
                  onChange={(e) => setUploadAsAt(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-md border border-border-strong px-3 py-2 text-xs hover:border-primary"
                >
                  {busy ? "Uploading…" : "Choose CSV file"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Required columns:{" "}
              {(uploadSource === "bank"
                ? OPEN_ITEM_BANK_REQUIRED
                : OPEN_ITEM_LEDGER_REQUIRED
              ).join(", ")}
              . Full template columns:{" "}
              {(uploadSource === "bank"
                ? OPEN_ITEM_BANK_HEADERS
                : OPEN_ITEM_LEDGER_HEADERS
              ).join(", ")}
            </p>

            {savedImports[uploadSource] && (
              <div className="mt-3 rounded-md border border-dashed border-border-strong bg-surface-2/40 p-3 text-[11px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      Last successful {uploadSource} import
                    </p>
                    <p className="mono text-muted-foreground">
                      {savedImports[uploadSource]!.filename} · as at{" "}
                      {savedImports[uploadSource]!.asAt} ·{" "}
                      {new Date(savedImports[uploadSource]!.at).toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">
                      Mapping: {savedImports[uploadSource]!.headers.length} columns
                      {savedImports[uploadSource]!.missing.length
                        ? ` · missing ${savedImports[uploadSource]!.missing.join(", ")}`
                        : " · all required columns present"}
                      {" · "}
                      <span className="text-success">
                        {savedImports[uploadSource]!.validCount} valid
                      </span>
                      {savedImports[uploadSource]!.invalidCount ? (
                        <>
                          {" · "}
                          <span className="text-destructive">
                            {savedImports[uploadSource]!.invalidCount} invalid
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void reimportSaved(uploadSource)}
                      disabled={busy || !companyId || !accountId}
                      className="rounded-md border border-border-strong px-3 py-1.5 hover:border-primary disabled:opacity-50"
                      title="Load the last file into the preview panel to review before importing."
                    >
                      Preview again
                    </button>
                    <button
                      onClick={() => void reimportSaved(uploadSource, { autoConfirm: true })}
                      disabled={busy || !companyId || !accountId}
                      className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      title="Re-run the same import with the previously validated mapping — one click."
                    >
                      Re-import now
                    </button>
                  </div>
                </div>
              </div>
            )}


            {(progress.active || progress.finishedAt) && (
              <div
                className={`mt-3 rounded-md border p-3 text-[11px] ${
                  progress.active
                    ? "border-primary/40 bg-primary/5"
                    : progress.errors.length
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-success/40 bg-success/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {progress.active
                      ? `Importing ${progress.source} open items…`
                      : progress.errors.length
                        ? `Import finished with errors (${progress.source})`
                        : `Import complete (${progress.source})`}
                  </p>
                  <p className="mono text-muted-foreground">
                    {progress.processed} / {progress.total} rows ·{" "}
                    <span className="text-success">
                      {progress.inserted} inserted
                    </span>{" "}
                    ·{" "}
                    <span className="text-destructive">
                      {progress.rejected} rejected
                    </span>
                    {progress.finishedAt ? (
                      <>
                        {" · "}
                        {(
                          (progress.finishedAt - progress.startedAt) /
                          1000
                        ).toFixed(1)}
                        s
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-surface-2">
                  <div
                    className={`h-full transition-all ${
                      progress.active
                        ? "bg-primary"
                        : progress.errors.length
                          ? "bg-destructive"
                          : "bg-success"
                    }`}
                    style={{
                      width: `${
                        progress.total
                          ? Math.min(
                              100,
                              Math.round(
                                (progress.processed / progress.total) * 100,
                              ),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                {!progress.active && progress.finishedAt && (
                  <p className="mt-2 text-muted-foreground">
                    Rows processed: <strong>{progress.total}</strong> · Inserted:{" "}
                    <strong className="text-success">{progress.inserted}</strong>{" "}
                    · Rejected:{" "}
                    <strong className="text-destructive">
                      {progress.rejected}
                    </strong>
                  </p>
                )}
                {progress.errors.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-destructive">
                    {progress.errors.slice(0, 3).map((e, i) => (
                      <li key={i} className="mono">
                        {e}
                      </li>
                    ))}
                    {progress.errors.length > 3 && (
                      <li className="text-muted-foreground">
                        +{progress.errors.length - 3} more…
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {preview && (
              <div className="mt-4 rounded-md border border-border-strong bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">
                      Preview — {preview.source} · as at {preview.asAt}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {preview.rows.length} row(s) parsed ·{" "}
                      <span className="text-success">
                        {preview.rows.filter((r) => r.valid).length} valid
                      </span>{" "}
                      ·{" "}
                      <span className="text-destructive">
                        {preview.rows.filter((r) => !r.valid).length} invalid
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPreview(null)}
                      className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-destructive"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void confirmImport()}
                      disabled={
                        busy ||
                        preview.missing.length > 0 ||
                        !preview.rows.some((r) => r.valid)
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {busy
                        ? "Importing…"
                        : `Confirm import (${preview.rows.filter((r) => r.valid).length})`}
                    </button>
                  </div>
                </div>

                {preview.missing.length > 0 ? (
                  <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                    Missing required column(s): {preview.missing.join(", ")}.
                    Fix the CSV headers and re-upload.
                  </p>
                ) : (
                  <p className="mt-2 rounded-md border border-success/40 bg-success/10 px-2 py-1.5 text-[11px] text-success">
                    All required columns present. Debit(Amount) &rarr; direction
                    "debit"; Credit(Amount) &rarr; direction "credit"; amount is
                    the non-zero side.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    placeholder="Search ref, narration, party…"
                    className="field flex-1 min-w-[180px] text-[11px]"
                  />
                  <select
                    value={previewStatus}
                    onChange={(e) =>
                      setPreviewStatus(e.target.value as typeof previewStatus)
                    }
                    className="field text-[11px]"
                  >
                    <option value="all">All rows</option>
                    <option value="valid">Valid only</option>
                    <option value="invalid">Invalid only</option>
                  </select>
                  {(previewSearch || previewStatus !== "all") && (
                    <button
                      onClick={() => {
                        setPreviewSearch("");
                        setPreviewStatus("all");
                      }}
                      className="rounded-md border border-border-strong px-2 py-1 text-[11px] hover:border-destructive"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {(() => {
                  const q = previewSearch.trim().toLowerCase();
                  const rows = preview.rows.filter((r) => {
                    if (previewStatus === "valid" && !r.valid) return false;
                    if (previewStatus === "invalid" && r.valid) return false;
                    if (q) {
                      const meta = r.values.meta || {};
                      const hay = [
                        r.values.doc_ref,
                        r.values.narration,
                        r.values.party_name,
                        (meta as Record<string, string>).Account ?? "",
                        (meta as Record<string, string>).Supplier_Invoice_No ?? "",
                      ]
                        .join(" ")
                        .toLowerCase();
                      if (!hay.includes(q)) return false;
                    }
                    return true;
                  });
                  return (
                    <div className="mt-2 max-h-64 overflow-auto rounded border border-border">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-surface-1">
                          <tr>
                            <th className="caption px-2 py-1.5">#</th>
                            <th className="caption px-2 py-1.5">As at</th>
                            <th className="caption px-2 py-1.5">Ref</th>
                            <th className="caption px-2 py-1.5">Party</th>
                            <th className="caption px-2 py-1.5">Narration</th>
                            <th className="caption px-2 py-1.5">Debit</th>
                            <th className="caption px-2 py-1.5">Credit</th>
                            <th className="caption px-2 py-1.5">→ Direction</th>
                            <th className="caption px-2 py-1.5">→ Amount</th>
                            <th className="caption px-2 py-1.5">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 50).map((r) => {
                            const debitShown =
                              r.values.direction === "debit" ? r.values.amount : 0;
                            const creditShown =
                              r.values.direction === "credit" ? r.values.amount : 0;
                            return (
                              <tr
                                key={r.index}
                                className={`border-t border-border ${
                                  r.valid ? "" : "bg-destructive/5"
                                }`}
                              >
                                <td className="mono px-2 py-1.5">{r.index}</td>
                                <td className="mono px-2 py-1.5">
                                  {r.values.as_at_date || "—"}
                                </td>
                                <td className="mono px-2 py-1.5">
                                  {r.values.doc_ref || "—"}
                                </td>
                                <td className="px-2 py-1.5">
                                  {r.values.party_name || "—"}
                                </td>
                                <td className="px-2 py-1.5 max-w-[220px] truncate" title={r.values.narration}>
                                  {r.values.narration || "—"}
                                </td>
                                <td className="mono px-2 py-1.5">
                                  {debitShown || "—"}
                                </td>
                                <td className="mono px-2 py-1.5">
                                  {creditShown || "—"}
                                </td>
                                <td className="mono px-2 py-1.5">
                                  {r.values.amount ? r.values.direction : "—"}
                                </td>
                                <td className="mono px-2 py-1.5">
                                  {r.values.amount || "—"}
                                </td>
                                <td className="px-2 py-1.5">
                                  {r.valid ? (
                                    <span className="text-success">OK</span>
                                  ) : (
                                    <span className="text-destructive">
                                      {r.error}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {!rows.length && (
                            <tr>
                              <td colSpan={10} className="px-2 py-4 text-center text-muted-foreground">
                                No rows match the current filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      {rows.length > 50 && (
                        <p className="border-t border-border bg-surface-1 px-2 py-1 text-[10px] text-muted-foreground">
                          Showing first 50 of {rows.length} matching rows ({preview.rows.length} total parsed).
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}


            {lastUpload && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px]">
                <span className="text-muted-foreground">
                  Last uploaded: <span className="mono">{lastUpload.filename}</span> ·{" "}
                  {lastUpload.source} · {new Date(lastUpload.at).toLocaleString()}
                </span>
                <button
                  onClick={downloadLastUpload}
                  className="rounded-md border border-border-strong px-3 py-1.5 hover:border-primary"
                >
                  Download uploaded CSV
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="caption">From</label>
                  <input
                    type="date"
                    className="field mt-1"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="caption">To</label>
                  <input
                    type="date"
                    className="field mt-1"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                <div>
                  <label className="caption">Side</label>
                  <select
                    className="field mt-1 text-[11px]"
                    value={sideFilter}
                    onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}
                  >
                    <option value="all">All</option>
                    <option value="bank">Bank</option>
                    <option value="ledger">Ledger</option>
                  </select>
                </div>
                <div>
                  <label className="caption">Direction</label>
                  <select
                    className="field mt-1 text-[11px]"
                    value={directionFilter}
                    onChange={(e) => setDirectionFilter(e.target.value as typeof directionFilter)}
                  >
                    <option value="all">All</option>
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="caption">Search</label>
                  <input
                    type="search"
                    className="field mt-1 text-[11px]"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Ref, narration, party, account…"
                  />
                </div>
                {(dateFrom || dateTo || search || sideFilter !== "all" || directionFilter !== "all") && (
                  <button
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                      setSearch("");
                      setSideFilter("all");
                      setDirectionFilter("all");
                    }}
                    className="rounded-md border border-border-strong px-2 py-1 text-[11px] hover:border-destructive"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => exportOpenItems("bank")}
                  disabled={!companyId || !accountId}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary disabled:opacity-50"
                >
                  Download bank open items ({filteredOpenItems.filter((o) => o.source === "bank").length})
                </button>
                <button
                  onClick={() => exportOpenItems("ledger")}
                  disabled={!companyId || !accountId}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary disabled:opacity-50"
                >
                  Download ledger open items ({filteredOpenItems.filter((o) => o.source === "ledger").length})
                </button>
                <button
                  onClick={downloadImportSummary}
                  disabled={!companyId || !accountId}
                  title="CSV with counts of new, invalid, and imported rows for bank & ledger — respects current filters."
                  className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary disabled:opacity-50"
                >
                  Download import summary
                </button>
                {(["bank", "ledger"] as const).map((side) => {
                  const rep = lastRejected[side];
                  const count = rep?.rows.length ?? 0;
                  return (
                    <button
                      key={side}
                      onClick={() => downloadErrorReport(side)}
                      disabled={!count}
                      title={
                        count
                          ? `CSV of every rejected ${side} row from the last import, with the exact reason and original cell values.`
                          : `No rejected ${side} rows from the last import.`
                      }
                      className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-destructive disabled:opacity-40"
                    >
                      Download {side} error report{count ? ` (${count})` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Exports use the current company, bank account, and date range. Downloads follow the fixed bank / ledger template columns.
            </p>

            <div className="mt-3 max-h-72 overflow-auto rounded border border-border">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-surface-2">
                  <tr>
                    <th className="caption px-2 py-1.5">Side</th>
                    <th className="caption px-2 py-1.5">As at</th>
                    <th className="caption px-2 py-1.5">Ref</th>
                    <th className="caption px-2 py-1.5">Party</th>
                    <th className="caption px-2 py-1.5">Direction</th>
                    <th className="caption px-2 py-1.5">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredOpenItems.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="mono px-2 py-1.5">{o.source}</td>
                      <td className="mono px-2 py-1.5">{o.as_at_date}</td>
                      <td className="mono px-2 py-1.5">{o.doc_ref ?? "—"}</td>
                      <td className="px-2 py-1.5">{o.party_name ?? "—"}</td>
                      <td className="mono px-2 py-1.5">{o.direction}</td>
                      <td className="mono px-2 py-1.5">{o.amount}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => void removeOpenItem(o.id)}
                          className="text-[10px] text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredOpenItems.length && (
                    <tr>
                      <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">
                        {openItems.length
                          ? "No open items match the current date range."
                          : "No open items yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
