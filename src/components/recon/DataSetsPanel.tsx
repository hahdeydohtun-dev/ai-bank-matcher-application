import { useState } from "react";
import { db, type ImportBatch } from "@/lib/recon/db";
import { formatDate } from "@/lib/recon/format";

export function DataSetsPanel({
  batches,
  companyId,
  bankAccountId,
  confirmDestructive,
  onChanged,
  onImport,
}: {
  batches: ImportBatch[];
  companyId: string;
  bankAccountId: string | null;
  confirmDestructive: boolean;
  onChanged: () => void;
  onImport: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function ask(message: string) {
    if (!confirmDestructive) return true;
    return window.confirm(message);
  }

  async function deleteBatch(batch: ImportBatch) {
    if (
      !ask(
        `Delete the imported set "${batch.label}" (${batch.row_count} rows)? The rows it created will be removed for everyone.`,
      )
    )
      return;
    setBusy(batch.id);
    setError(null);
    try {
      const table = batch.source === "bank" ? "bank_transactions" : "accounting_records";
      const { error: rowErr } = await db.from(table).delete().eq("import_batch_id", batch.id);
      if (rowErr) throw rowErr;
      const { error: bErr } = await db.from("import_batches").delete().eq("id", batch.id);
      if (bErr) throw bErr;
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the data set");
    } finally {
      setBusy(null);
    }
  }

  async function clearSide(source: "bank" | "ledger") {
    const label = source === "bank" ? "bank statement transactions" : "ERP ledger records";
    if (!ask(`Clear ALL ${label} for this workspace so a new file can be uploaded?`)) return;
    setBusy(source);
    setError(null);
    try {
      if (source === "bank") {
        let query = db.from("bank_transactions").delete().eq("company_id", companyId);
        if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
        const { error: err } = await query;
        if (err) throw err;
      } else {
        let query = db
          .from("accounting_records")
          .delete()
          .eq("company_id", companyId);
        if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
        const { error: err } = await query;
        if (err) throw err;
      }
      await db.from("match_suggestions").delete().eq("company_id", companyId);
      await db.from("match_groups").delete().eq("company_id", companyId);
      let batchQuery = db
        .from("import_batches")
        .delete()
        .eq("company_id", companyId)
        .eq("source", source);
      if (bankAccountId) batchQuery = batchQuery.eq("bank_account_id", bankAccountId);
      await batchQuery;
      // Drop the period markers too so the same period can be re-imported.
      let setQuery = db
        .from("data_sets")
        .delete()
        .eq("company_id", companyId)
        .eq("source", source);
      if (bankAccountId) setQuery = setQuery.eq("bank_account_id", bankAccountId);
      await setQuery;
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the data set");
    } finally {
      setBusy(null);
    }
  }

  const bank = batches.filter((b) => b.source === "bank");
  const ledger = batches.filter((b) => b.source !== "bank");

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="caption">Data sets</p>
          <h2 className="text-sm font-semibold">Imported files</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onImport}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
          >
            Import data
          </button>
          <button
            onClick={() => void clearSide("bank")}
            disabled={busy === "bank"}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-destructive hover:text-destructive disabled:opacity-50"
          >
            Clear bank set
          </button>
          <button
            onClick={() => void clearSide("ledger")}
            disabled={busy === "ledger"}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-destructive hover:text-destructive disabled:opacity-50"
          >
            Clear ledger set
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {(
          [
            ["Bank statement imports", bank],
            ["ERP ledger imports", ledger],
          ] as const
        ).map(([title, list]) => (
          <div key={title} className="panel-2 p-3">
            <p className="caption">{title}</p>
            {!list.length && (
              <p className="mt-2 text-xs text-muted-foreground">No tracked imports yet.</p>
            )}
            <ul className="mt-2 space-y-1.5">
              {list.map((batch) => (
                <li
                  key={batch.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{batch.label}</p>
                    <p className="mono text-[10px] text-muted-foreground">
                      {batch.row_count} rows · {formatDate(batch.created_at)} ·{" "}
                      {batch.created_by_email ?? "—"}
                    </p>
                  </div>
                  <button
                    onClick={() => void deleteBatch(batch)}
                    disabled={busy === batch.id}
                    className="shrink-0 rounded border border-border-strong px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                  >
                    {busy === batch.id ? "Deleting…" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
