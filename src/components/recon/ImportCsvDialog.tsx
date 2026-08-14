import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BANK_FIELDS,
  LEDGER_FIELDS,
  buildRows,
  detectFormat,
  guessMapping,
  parseCsv,
  templateCsv,
  type CsvTable,
  type Format,
  type ParsedRow,
} from "@/lib/recon/csv";
import { db, supabase } from "@/lib/recon/db";
import { useSettings } from "@/lib/recon/settings";
import { fetchBankStatement } from "@/lib/recon/bankApi.functions";
import { fetchErpLedger } from "@/lib/recon/erpApi.functions";
import {
  FETCH_STEPS,
  STEP_LABELS,
  applicablePreset,
  buildIdempotencyKey,
  clearMappingPreset,
  downloadCsv,
  isDuplicateKeyError,
  loadLastRun,
  loadMappingPreset,
  saveLastRun,
  saveMappingPreset,
  toCsv,
  type ImportRun,
  type StepKey,
} from "@/lib/recon/importPresets";

type Source = "csv" | "bank_api" | "erp_api";

/** Flatten fetched API rows into the same shape the CSV mapper works with. */
function rowsToTable(rows: Array<Record<string, unknown>>): CsvTable {
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
  }
  const cells = rows.map((row) =>
    headers.map((h) => {
      const v = row[h];
      if (v === null || v === undefined) return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    }),
  );
  return { headers, rows: cells };
}

export function ImportCsvDialog({
  open,
  onClose,
  companyId,
  bankAccountId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  bankAccountId: string | null;
  onImported: () => void;
}) {
  const [settings] = useSettings(companyId);
  const [source, setSource] = useState<Source>("csv");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [format, setFormat] = useState<Format>("bank");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [bankConn, setBankConn] = useState<{
    enabled: boolean;
    provider_label: string | null;
  } | null>(null);
  const [erpConn, setErpConn] = useState<{
    enabled: boolean;
    erp_system: string | null;
    gl_account_code: string | null;
  } | null>(null);
  const [step, setStep] = useState<StepKey | null>(null);
  const [runLog, setRunLog] = useState<{ at: string; message: string }[]>([]);
  const [lastRun, setLastRun] = useState<ImportRun | null>(null);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const callFetchStatement = useServerFn(fetchBankStatement);
  const callFetchLedger = useServerFn(fetchErpLedger);

  const fields = format === "bank" ? BANK_FIELDS : LEDGER_FIELDS;
  const rows: ParsedRow[] = useMemo(
    () => (table ? buildRows(table, fields, mapping) : []),
    [table, fields, mapping],
  );
  const validRows = rows.filter((r) => r.valid);
  const skippedRows = rows.filter((r) => !r.valid);

  function log(message: string) {
    setRunLog((l) => [...l, { at: new Date().toISOString(), message }]);
  }

  /** Apply a saved preset for this company + account + source when it still fits. */
  async function autoMap(headers: string[], nextFormat: Format, src: Source) {
    const preset = bankAccountId
      ? await loadMappingPreset(companyId, bankAccountId, src, nextFormat)
      : null;
    const usable = applicablePreset(preset?.mapping, headers);
    if (usable) {
      setPresetNote(
        `Auto-mapped from your saved preset (${new Date(preset!.savedAt).toLocaleDateString()}).`,
      );
      return usable;
    }
    setPresetNote(null);
    return guessMapping(headers, nextFormat === "bank" ? BANK_FIELDS : LEDGER_FIELDS);
  }

  // Infer period start/end from parsed rows when the user hasn't picked one yet.
  const inferredRange = useMemo(() => {
    const dates = rows.map((r) => r.date).filter(Boolean) as string[];
    if (!dates.length) return null;
    dates.sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [rows]);

  useEffect(() => {
    if (open) setLastRun(loadLastRun());
  }, [open]);

  useEffect(() => {
    if (!open || !companyId || !bankAccountId) {
      setBankConn(null);
      setErpConn(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [bankRes, erpRes] = await Promise.all([
        db
          .from("bank_api_connections")
          .select("enabled, provider_label")
          .eq("company_id", companyId)
          .eq("bank_account_id", bankAccountId)
          .maybeSingle(),
        db
          .from("erp_api_connections")
          .select("enabled, erp_system, gl_account_code")
          .eq("company_id", companyId)
          .eq("bank_account_id", bankAccountId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setBankConn((bankRes.data as typeof bankConn) ?? null);
      setErpConn((erpRes.data as typeof erpConn) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, companyId, bankAccountId]);

  const bankFetchDisabledReason = !settings.apiIntegrationEnabled
    ? "Bank portal API integration is off — turn it on in the Control Panel."
    : !companyId
      ? "Select a company first."
      : !bankAccountId
        ? "Select a bank account first."
        : !bankConn
          ? "No bank portal connection configured for this account — set it up in Control Panel → API integration."
          : !bankConn.enabled
            ? "The bank portal connection for this account is paused."
            : null;

  const erpFetchDisabledReason = !settings.erpApiIntegrationEnabled
    ? "ERP API integration is off — turn it on in the Control Panel."
    : !companyId
      ? "Select a company first."
      : !bankAccountId
        ? "Select a bank account first."
        : !erpConn
          ? "No ERP connection configured for this account — set it up in Control Panel → API integration."
          : !erpConn.enabled
            ? "The ERP connection for this account is paused."
            : !erpConn.gl_account_code
              ? "No ERP GL/cash account is mapped to this bank account."
              : null;

  if (!open) return null;

  async function loadText(text: string, name: string) {
    const parsed = parseCsv(text);
    const detected = detectFormat(parsed.headers);
    setTable(parsed);
    setFileName(name);
    setFormat(detected);
    setMapping(await autoMap(parsed.headers, detected, "csv"));
    setError(null);
  }

  async function handleFile(file: File) {
    await loadText(await file.text(), file.name);
  }

  function persistRun(patch: Partial<ImportRun>, logEntries: { at: string; message: string }[]) {
    const run: ImportRun = {
      at: new Date().toISOString(),
      source,
      format,
      companyId,
      bankAccountId,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      label: fileName,
      step: "queued",
      status: "running",
      error: null,
      rowsFetched: 0,
      rowsValid: 0,
      rowsSkipped: 0,
      rowsInserted: 0,
      skipped: [],
      log: logEntries,
      ...patch,
    };
    saveLastRun(run);
    setLastRun(run);
  }

  async function runFetch(kind: "bank_api" | "erp_api") {
    if (fetching) return;
    const reason = kind === "bank_api" ? bankFetchDisabledReason : erpFetchDisabledReason;
    if (reason) {
      setError(reason);
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Pick a period start and end date before fetching.");
      return;
    }
    setFetching(true);
    setError(null);
    setRunLog([]);
    setStep("queued");
    const entries: { at: string; message: string }[] = [];
    const note = (message: string) => {
      const entry = { at: new Date().toISOString(), message };
      entries.push(entry);
      setRunLog((l) => [...l, entry]);
    };
    note(`Queued ${kind === "bank_api" ? "bank statement" : "ledger"} fetch for ${periodStart} → ${periodEnd}.`);
    try {
      setStep("fetching");
      note("Calling the connection endpoint…");
      const payload = {
        data: {
          companyId,
          bankAccountId: bankAccountId as string,
          periodStart,
          periodEnd,
          preview: true,
        },
      };
      const result =
        kind === "bank_api" ? await callFetchStatement(payload) : await callFetchLedger(payload);
      const fetched = result.rows ?? [];
      note(`Received ${fetched.length} row(s).`);
      if (!fetched.length) {
        setTable(null);
        setStep(null);
        setError("The API returned no rows for this period.");
        persistRun(
          { status: "error", step: "fetching", error: "No rows returned for this period." },
          entries,
        );
        return;
      }
      setStep("parsing");
      note("Parsing and mapping columns…");
      const parsed = rowsToTable(fetched);
      const nextFormat: Format = kind === "bank_api" ? "bank" : "ledger";
      setTable(parsed);
      setFormat(nextFormat);
      setMapping(await autoMap(parsed.headers, nextFormat, kind));
      setFileName(
        kind === "bank_api"
          ? `${bankConn?.provider_label || "Bank portal"} ${periodStart} → ${periodEnd}`
          : `${erpConn?.erp_system || "ERP"} ledger ${periodStart} → ${periodEnd}`,
      );
      note("Ready for review — nothing has been written yet.");
      setStep("writing");
      persistRun(
        { status: "success", step: "parsing", rowsFetched: fetched.length, format: nextFormat },
        entries,
      );
    } catch (err) {
      const message = importErrorMessage(err);
      note(`Failed: ${message}`);
      setError(message);
      setStep(null);
      persistRun({ status: "error", step: "fetching", error: message }, entries);
    } finally {
      setFetching(false);
    }
  }

  async function switchFormat(next: Format) {
    setFormat(next);
    if (table) {
      setMapping(await autoMap(table.headers, next, source));
    }
  }

  function exportPreview() {
    if (!table) return;
    const headers = ["row", "status", "reason", ...fields.map((f) => f.label), "extra_fields"];
    const body = rows.map((row) => [
      String(row.index + 1),
      row.valid ? "ready" : "skipped",
      row.reason ?? "",
      ...fields.map((f) => row.values[f.key] ?? ""),
      String(Object.keys(row.meta).length),
    ]);
    downloadCsv(
      `import-preview-${format}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, body),
    );
  }

  function exportSkipped() {
    const headers = ["row", "reason", ...fields.map((f) => f.label)];
    const body = skippedRows.map((row) => [
      String(row.index + 1),
      row.reason ?? "Invalid row",
      ...fields.map((f) => row.values[f.key] ?? ""),
    ]);
    downloadCsv(
      `import-skipped-${format}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, body),
    );
  }


  function downloadTemplate(kind: Format) {
    const blob = new Blob([templateCsv(kind)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "bank" ? "bank-statement-template.csv" : "erp-bank-ledger-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importErrorMessage(err: unknown) {
    if (err instanceof Error) return err.message;
    if (typeof err === "object" && err && "message" in err) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    return "Import failed";
  }

  async function confirmImport() {
    if (!validRows.length) return;
    if (!companyId) {
      setError("Select a company before importing.");
      return;
    }
    if (format === "bank" && !bankAccountId) {
      setError("Select a bank account before importing a bank statement.");
      return;
    }
    if (format === "ledger" && !bankAccountId) {
      setError("Select the bank account this ledger extract belongs to.");
      return;
    }
    const selectedBankAccountId = bankAccountId;
    if (!selectedBankAccountId) {
      setError("Select a bank account before importing.");
      return;
    }
    const effectiveStart = periodStart || inferredRange?.start || null;
    const effectiveEnd = periodEnd || inferredRange?.end || null;
    if (!effectiveStart || !effectiveEnd) {
      setError("Pick a period start and end date.");
      return;
    }
    setBusy(true);
    setError(null);
    setStep("writing");
    const entries: { at: string; message: string }[] = [];
    const note = (message: string) => {
      const entry = { at: new Date().toISOString(), message };
      entries.push(entry);
      setRunLog((l) => [...l, entry]);
    };
    const skippedDetail = skippedRows.slice(0, 500).map((row) => ({
      index: row.index + 1,
      reason: row.reason ?? "Invalid row",
      preview: fields
        .map((f) => row.values[f.key])
        .filter(Boolean)
        .join(" · ")
        .slice(0, 160),
    }));

    const idempotencyKey = buildIdempotencyKey({
      companyId,
      bankAccountId: selectedBankAccountId,
      source,
      format,
      periodStart: effectiveStart,
      periodEnd: effectiveEnd,
      fileSignature: `${fileName}:${rows.length}`,
    });

    let batchId: string | null = null;
    let dataSetId: string | null = null;
    try {
      const { data: existing } = await db
        .from("data_sets")
        .select("id, label")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        const message =
          "This exact period was already ingested for this bank account from this source — nothing was duplicated.";
        note(message);
        setError(message);
        setStep(null);
        persistRun(
          {
            status: "error",
            step: "writing",
            error: message,
            rowsFetched: rows.length,
            rowsValid: validRows.length,
            rowsSkipped: skippedRows.length,
            skipped: skippedDetail,
          },
          entries,
        );
        return;
      }

      batchId = crypto.randomUUID();
      dataSetId = crypto.randomUUID();
      const { data: userData } = await supabase.auth.getUser();
      note(`Writing ${validRows.length} row(s), skipping ${skippedRows.length}.`);

      const { error: dsErr } = await db.from("data_sets").insert({
        id: dataSetId,
        company_id: companyId,
        bank_account_id: selectedBankAccountId,
        source: format,
        period_start: effectiveStart,
        period_end: effectiveEnd,
        label: fileName || `${format} import`,
        row_count: validRows.length,
        created_by_email: userData.user?.email ?? null,
        idempotency_key: idempotencyKey,
      });
      if (dsErr) throw dsErr;

      const { error: batchErr } = await db.from("import_batches").insert({
        id: batchId,
        company_id: companyId,
        bank_account_id: selectedBankAccountId,
        source: format,
        label: fileName || `${format} import`,
        row_count: validRows.length,
        created_by_email: userData.user?.email ?? null,
      });
      if (batchErr) throw batchErr;

      if (format === "bank") {
        const payload = validRows.map((row) => ({
          company_id: companyId,
          bank_account_id: selectedBankAccountId,
          txn_ref: row.values.txn_ref,
          amount: row.amount,
          direction: row.direction === "debit" ? "debit" : "credit",
          txn_date: row.date,
          value_date: row.valueDate ?? row.date,
          balance: row.values.balance ? Number(row.values.balance.replace(/[^0-9.-]/g, "")) : null,
          narration: row.values.narration || null,
          status: "unreconciled",
          import_batch_id: batchId,
          data_set_id: dataSetId,
          period_start: effectiveStart,
          period_end: effectiveEnd,
          meta: row.meta,
        }));
        for (let i = 0; i < payload.length; i += 500) {
          const { error: err } = await db
            .from("bank_transactions")
            .insert(payload.slice(i, i + 500));
          if (err) throw err;
        }
      } else {
        const payload = validRows.map((row) => ({
          company_id: companyId,
          bank_account_id: selectedBankAccountId,
          doc_type: row.values.doc_type || null,
          doc_number: row.values.doc_number,
          party_name: row.values.party_name || null,
          party_type: row.values.party_type || null,
          amount: row.amount,
          balance: row.values.balance ? Number(row.values.balance.replace(/[^0-9.-]/g, "")) : null,
          doc_date: row.date,
          side: row.direction,
          status: "open",
          import_batch_id: batchId,
          data_set_id: dataSetId,
          period_start: effectiveStart,
          period_end: effectiveEnd,
          meta: row.meta,
        }));
        const { error: err } = await db
          .from("accounting_records")
          .upsert(payload, { onConflict: "company_id,bank_account_id,doc_number" });
        if (err) throw err;
      }

      // Remember the mapping so the next import of this shape auto-maps
      // (shared with the rest of the team, since it's stored per company).
      await saveMappingPreset(companyId, selectedBankAccountId, source, format, mapping);
      note("Import complete.");
      setStep("done");
      persistRun(
        {
          status: "success",
          step: "done",
          error: null,
          rowsFetched: rows.length,
          rowsValid: validRows.length,
          rowsSkipped: skippedRows.length,
          rowsInserted: validRows.length,
          skipped: skippedDetail,
        },
        entries,
      );
      onImported();
      setTable(null);
      setFileName("");
      setPeriodStart("");
      setPeriodEnd("");
      onClose();
    } catch (err) {
      if (batchId) {
        await db.from("import_batches").delete().eq("id", batchId);
      }
      if (dataSetId) {
        await db.from("data_sets").delete().eq("id", dataSetId);
      }
      const message = isDuplicateKeyError(err)
        ? "This period was already ingested for this bank account from this source — nothing was duplicated."
        : importErrorMessage(err);
      note(`Failed: ${message}`);
      setError(message);
      setStep(null);
      persistRun(
        {
          status: "error",
          step: "writing",
          error: message,
          rowsFetched: rows.length,
          rowsValid: validRows.length,
          rowsSkipped: skippedRows.length,
          skipped: skippedDetail,
        },
        entries,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <div className="panel my-6 w-full max-w-4xl p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="caption">Import</p>
            <h2 className="text-lg font-semibold">Import data</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border-strong px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>

        {(!companyId || !bankAccountId) && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Select a company{!bankAccountId ? " and bank account" : ""} in the toolbar before
            importing. Every imported row is tagged with both.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { key: "csv" as Source, label: "Upload CSV" },
            { key: "bank_api" as Source, label: "Fetch bank statement" },
            { key: "erp_api" as Source, label: "Fetch ledger" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setSource(s.key);
                setTable(null);
                setFileName("");
                setError(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                source === s.key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border-strong text-muted-foreground hover:border-primary"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {(step || runLog.length > 0) && (
          <div className="mt-4 rounded-lg border border-border-strong bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {FETCH_STEPS.map((s, i) => {
                const currentIndex = step ? FETCH_STEPS.indexOf(step) : -1;
                const state =
                  currentIndex < 0 ? "pending" : i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
                return (
                  <span
                    key={s}
                    className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      state === "active"
                        ? "border-primary bg-primary/15 text-primary"
                        : state === "done"
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {STEP_LABELS[s]}
                  </span>
                );
              })}
            </div>
            {runLog.length > 0 && (
              <ul className="mono mt-2 max-h-28 space-y-0.5 overflow-auto text-[10px] text-muted-foreground">
                {runLog.map((l, i) => (
                  <li key={i}>
                    {new Date(l.at).toLocaleTimeString()} — {l.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {lastRun && (
          <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="caption">Last run · {new Date(lastRun.at).toLocaleString()}</p>
                <p className="text-xs">
                  <span
                    className={
                      lastRun.status === "success" ? "text-success" : "text-destructive"
                    }
                  >
                    {lastRun.status === "success" ? "Succeeded" : "Failed"} at {STEP_LABELS[lastRun.step]}
                  </span>{" "}
                  · {lastRun.source === "csv" ? "CSV" : lastRun.source === "bank_api" ? "Bank API" : "ERP API"} ·{" "}
                  {lastRun.rowsFetched} fetched · {lastRun.rowsInserted} inserted ·{" "}
                  {lastRun.rowsSkipped} skipped
                </p>
                {lastRun.error && (
                  <p className="mt-1 text-[11px] text-destructive">{lastRun.error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {lastRun.source !== "csv" && (
                  <button
                    onClick={() => {
                      setSource(lastRun.source);
                      if (lastRun.periodStart) setPeriodStart(lastRun.periodStart);
                      if (lastRun.periodEnd) setPeriodEnd(lastRun.periodEnd);
                      void runFetch(lastRun.source === "bank_api" ? "bank_api" : "erp_api");
                    }}
                    disabled={fetching}
                    className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary disabled:opacity-50"
                  >
                    Retry fetch
                  </button>
                )}
                {lastRun.log.length > 0 && (
                  <button
                    onClick={() =>
                      downloadCsv(
                        "import-run-log.csv",
                        toCsv(
                          ["time", "message"],
                          lastRun.log.map((l) => [l.at, l.message]),
                        ),
                      )
                    }
                    className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
                  >
                    Download log
                  </button>
                )}
                {lastRun.skipped.length > 0 && (
                  <button
                    onClick={() =>
                      downloadCsv(
                        "import-skipped-rows.csv",
                        toCsv(
                          ["row", "reason", "preview"],
                          lastRun.skipped.map((s) => [String(s.index), s.reason, s.preview]),
                        ),
                      )
                    }
                    className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
                  >
                    Download skipped rows
                  </button>
                )}
              </div>
            </div>
            {lastRun.skipped.length > 0 && (
              <ul className="mono mt-2 max-h-28 space-y-0.5 overflow-auto text-[10px] text-warning">
                {lastRun.skipped.slice(0, 50).map((s) => (
                  <li key={s.index}>
                    Row {s.index}: {s.reason}
                    {s.preview ? ` — ${s.preview}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}


        {source === "csv" && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => downloadTemplate("bank")}
                className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
              >
                Download bank statement template
              </button>
              <button
                onClick={() => downloadTemplate("ledger")}
                className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
              >
                Download ERP ledger template
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
              onClick={() => inputRef.current?.click()}
              className={`mt-4 cursor-pointer rounded-lg border border-dashed p-8 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border-strong"
              }`}
            >
              <p className="text-sm">{fileName || "Drop a CSV here, or click to choose a file"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bank statement or ERP bank ledger exports
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </div>
          </>
        )}

        {source !== "csv" && (
          <div className="mt-4 rounded-lg border border-border-strong bg-surface-2 p-4">
            <p className="text-sm font-semibold">
              {source === "bank_api"
                ? bankConn?.provider_label || "Bank portal API"
                : erpConn?.erp_system || "ERP API"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Fetch the period below from the API, then review and map the rows before they are
              ingested — exactly like a CSV upload.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="caption">Period start</label>
                <input
                  type="date"
                  className="field mt-1"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <label className="caption">Period end</label>
                <input
                  type="date"
                  className="field mt-1"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <button
              onClick={() => void runFetch(source === "bank_api" ? "bank_api" : "erp_api")}
              disabled={
                fetching ||
                !!(source === "bank_api" ? bankFetchDisabledReason : erpFetchDisabledReason)
              }
              title={
                (source === "bank_api" ? bankFetchDisabledReason : erpFetchDisabledReason) ??
                "Fetch rows for preview"
              }
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetching
                ? "Fetching…"
                : source === "bank_api"
                  ? "Fetch bank statement"
                  : "Fetch ledger"}
            </button>
            {(source === "bank_api" ? bankFetchDisabledReason : erpFetchDisabledReason) && (
              <p className="mt-2 text-xs text-warning">
                {source === "bank_api" ? bankFetchDisabledReason : erpFetchDisabledReason}
              </p>
            )}
          </div>
        )}

        {error && !table && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {table && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="caption">Detected format</span>
              {(["bank", "ledger"] as Format[]).map((f) => (
                <button
                  key={f}
                  onClick={() => switchFormat(f)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                    format === f
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border-strong text-muted-foreground"
                  }`}
                >
                  {f === "bank" ? "Bank statement" : "ERP bank ledger"}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-md border border-border-strong bg-surface-2 p-3">
              <p className="caption">Period · required · tagged onto every imported row</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="caption">Period start</label>
                  <input
                    type="date"
                    className="field mt-1"
                    value={periodStart || inferredRange?.start || ""}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="caption">Period end</label>
                  <input
                    type="date"
                    className="field mt-1"
                    value={periodEnd || inferredRange?.end || ""}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
              </div>
              {inferredRange && !periodStart && !periodEnd && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Inferred from the file: {inferredRange.start} → {inferredRange.end}
                </p>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="caption">
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <select
                    className="field mt-1"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                  >
                    <option value="">— not mapped —</option>
                    {table.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {presetNote && (
                <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary">
                  {presetNote}
                </span>
              )}
              <button
                onClick={() => {
                  if (!bankAccountId) return;
                  void saveMappingPreset(companyId, bankAccountId, source, format, mapping).then(
                    () => setPresetNote("Mapping saved as the preset for this account and source (shared with your team)."),
                  );
                }}
                disabled={!bankAccountId}
                className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary disabled:opacity-50"
              >
                Save mapping preset
              </button>
              <button
                onClick={() => {
                  if (!bankAccountId) return;
                  void clearMappingPreset(companyId, bankAccountId, source, format).then(() =>
                    setPresetNote("Preset cleared."),
                  );
                }}
                disabled={!bankAccountId}
                className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] hover:border-primary disabled:opacity-50"
              >
                Clear preset
              </button>
              <button
                onClick={exportPreview}
                className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
              >
                Export preview CSV
              </button>
              {skippedRows.length > 0 && (
                <button
                  onClick={exportSkipped}
                  className="rounded-md border border-warning/40 px-2.5 py-1 text-[11px] font-semibold text-warning hover:border-warning"
                >
                  Export {skippedRows.length} skipped row(s)
                </button>
              )}
            </div>


            <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-surface-2">
                  <tr>
                    <th className="caption px-2 py-1.5">Status</th>
                    {fields.map((f) => (
                      <th key={f.key} className="caption px-2 py-1.5">
                        {f.label}
                      </th>
                    ))}
                    <th className="caption px-2 py-1.5">Extra → meta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((row) => (
                    <tr key={row.index} className="border-t border-border">
                      <td className="px-2 py-1.5" title={row.reason ?? "Valid"}>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            row.valid
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-warning/40 bg-warning/10 text-warning"
                          }`}
                        >
                          {row.valid ? "OK" : "Check"}
                        </span>
                      </td>
                      {fields.map((f) => (
                        <td key={f.key} className="mono px-2 py-1.5 text-muted-foreground">
                          {row.values[f.key] || "—"}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {Object.keys(row.meta).length} field(s)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {validRows.length} of {rows.length} rows ready to import
              </p>
              <button
                onClick={confirmImport}
                disabled={busy || !validRows.length}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Importing…" : `Import ${validRows.length} rows`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
