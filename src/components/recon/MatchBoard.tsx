import { useEffect, useMemo, useState } from "react";
import type {
  AccountingRecord,
  BankTransaction,
  MatchSuggestion,
} from "@/lib/recon/db";
import { formatAmount, formatDate, CATEGORY_META, TONE_CLASS } from "@/lib/recon/format";

type Props = {
  transactions: BankTransaction[];
  records: AccountingRecord[];
  suggestions: Record<string, MatchSuggestion>;
  currency: string;
  busyId: string | null;
  merging: boolean;
  running: boolean;
  pendingAutoCount: number;
  onAccept: (txn: BankTransaction, recordId: string | null) => void;
  onReject: (txn: BankTransaction) => void;
  onMerge: (txnIds: string[], recordIds: string[], note: string) => void;
  onAiSuggest: () => void;
  onBulkApprove: () => void;
  onBulkAccept: (txnIds: string[]) => void;
  onBulkReject: (txnIds: string[]) => void;
};

function toggle(set: string[], id: string) {
  return set.includes(id) ? set.filter((x) => x !== id) : [...set, id];
}

// Builds searchable tokens for a date so partial searches (year, month name,
// numeric month, "2024-03", "Mar 2024", "03/2024") all match.
function dateTokens(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const monthLong = d.toLocaleDateString("en-GB", { month: "long" });
  const monthShort = d.toLocaleDateString("en-GB", { month: "short" });
  return [
    String(value),
    formatDate(value),
    `${yyyy}-${mm}`,
    `${yyyy}-${mm}-${dd}`,
    `${dd}/${mm}/${yyyy}`,
    `${mm}/${yyyy}`,
    `${monthShort} ${yyyy}`,
    `${monthLong} ${yyyy}`,
    monthLong,
    monthShort,
    yyyy,
  ].join(" ");
}

type FilterMode = "any" | "all";

// A filter string is split on commas / semicolons / newlines into groups.
// Each group is one or more words that must ALL appear (phrase-ish match).
// Mode "any" keeps a row when at least one group matches, "all" requires every group.
function parseFilter(value: string) {
  return value
    .toUpperCase()
    .split(/[,;\n]+/)
    .map((g) => g.trim().split(/\s+/).filter(Boolean))
    .filter((g) => g.length > 0);
}

function matchGroups(haystack: string, groups: string[][], mode: FilterMode) {
  const test = (g: string[]) => g.every((w) => haystack.includes(w));
  return mode === "all" ? groups.every(test) : groups.some(test);
}




export function MatchBoard({
  transactions,
  records,
  suggestions,
  currency,
  busyId,
  merging,
  running,
  pendingAutoCount,
  onAccept,
  onReject,
  onMerge,
  onAiSuggest,
  onBulkApprove,
  onBulkAccept,
  onBulkReject,
}: Props) {
  const [txnIds, setTxnIds] = useState<string[]>([]);
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  // Narration / remarks word filter (applied only when the user clicks Apply).
  const [bankFilterOpen, setBankFilterOpen] = useState(false);
  const [bankFilterDraft, setBankFilterDraft] = useState("");
  const [bankFilter, setBankFilter] = useState("");
  const [bankFilterModeDraft, setBankFilterModeDraft] = useState<FilterMode>("any");
  const [bankFilterMode, setBankFilterMode] = useState<FilterMode>("any");
  const [ledgerFilterOpen, setLedgerFilterOpen] = useState(false);
  const [ledgerFilterDraft, setLedgerFilterDraft] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState("");
  const [ledgerFilterModeDraft, setLedgerFilterModeDraft] = useState<FilterMode>("any");
  const [ledgerFilterMode, setLedgerFilterMode] = useState<FilterMode>("any");

  const bankRows = useMemo(() => {
    const q = bankQuery.trim().toUpperCase();
    const groups = parseFilter(bankFilter);
    return transactions.filter((t) => {
      if (openOnly && t.status !== "unreconciled") return false;
      if (groups.length) {
        const narration = (t.narration ?? "").toUpperCase();
        if (!matchGroups(narration, groups, bankFilterMode)) return false;
      }
      if (!q) return true;
      const meta = (t as unknown as { meta?: Record<string, unknown> }).meta;
      const remarks = (meta?.Remarks ?? meta?.remarks ?? "") as string;
      const haystack = [
        t.txn_ref,
        t.narration ?? "",
        t.amount,
        t.direction ?? "",
        remarks,
        dateTokens(t.txn_date),
        dateTokens((t as unknown as { value_date?: string | null }).value_date),
      ]
        .join(" ")
        .toUpperCase();
      return haystack.includes(q);
    });
  }, [transactions, bankQuery, openOnly, bankFilter, bankFilterMode]);

  const ledgerRows = useMemo(() => {
    const q = ledgerQuery.trim().toUpperCase();
    const groups = parseFilter(ledgerFilter);
    return records.filter((r) => {
      if (openOnly && (r.status ?? "open") !== "open") return false;
      const remarks = (r.meta?.Remarks ?? r.meta?.remarks ?? "") as string;
      if (groups.length) {
        const hay = String(remarks).toUpperCase();
        if (!matchGroups(hay, groups, ledgerFilterMode)) return false;
      }
      if (!q) return true;
      const haystack = [
        r.doc_number,
        r.party_name ?? "",
        r.doc_type ?? "",
        r.amount,
        remarks,
        dateTokens(r.doc_date),
      ]
        .join(" ")
        .toUpperCase();
      return haystack.includes(q);
    });
  }, [records, ledgerQuery, openOnly, ledgerFilter, ledgerFilterMode]);




  // Auto-deselect rows that are no longer visible after filter/search changes.
  const visibleBankIds = useMemo(() => new Set(bankRows.map((r) => r.id)), [bankRows]);
  const visibleLedgerIds = useMemo(
    () => new Set(ledgerRows.map((r) => r.id)),
    [ledgerRows],
  );
  useEffect(() => {
    setTxnIds((prev) => prev.filter((id) => visibleBankIds.has(id)));
  }, [visibleBankIds]);
  useEffect(() => {
    setRecordIds((prev) => prev.filter((id) => visibleLedgerIds.has(id)));
  }, [visibleLedgerIds]);
  // Anchors are stored as row ids (not indexes) so they stay correct when the
  // filtered list changes order/length.
  const [bankAnchor, setBankAnchor] = useState<string | null>(null);
  const [ledgerAnchor, setLedgerAnchor] = useState<string | null>(null);

  // Drop anchors that are no longer visible.
  useEffect(() => {
    setBankAnchor((a) => (a && visibleBankIds.has(a) ? a : null));
  }, [visibleBankIds]);
  useEffect(() => {
    setLedgerAnchor((a) => (a && visibleLedgerIds.has(a) ? a : null));
  }, [visibleLedgerIds]);

  const allBankSelected = bankRows.length > 0 && bankRows.every((r) => txnIds.includes(r.id));
  const allLedgerSelected =
    ledgerRows.length > 0 && ledgerRows.every((r) => recordIds.includes(r.id));

  function toggleAllBank() {
    if (allBankSelected) setTxnIds((prev) => prev.filter((id) => !visibleBankIds.has(id)));
    else
      setTxnIds((prev) => Array.from(new Set([...prev, ...bankRows.map((r) => r.id)])));
  }
  function toggleAllLedger() {
    if (allLedgerSelected)
      setRecordIds((prev) => prev.filter((id) => !visibleLedgerIds.has(id)));
    else
      setRecordIds((prev) =>
        Array.from(new Set([...prev, ...ledgerRows.map((r) => r.id)])),
      );
  }

  // Shift + ArrowUp/ArrowDown extends the selection line by line, always
  // starting from the row you last clicked/ticked (the anchor).
  // Adding Ctrl/Cmd keeps existing selections, so several non-contiguous
  // ranges can be combined.
  function rowKeyDown(
    e: React.KeyboardEvent<HTMLLIElement>,
    index: number,
    ids: string[],
    anchorId: string | null,
    setAnchor: (id: string | null) => void,
    setSelected: React.Dispatch<React.SetStateAction<string[]>>,
  ) {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = Math.min(ids.length - 1, Math.max(0, index + dir));
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const anchorIndex = anchorId ? ids.indexOf(anchorId) : -1;
      const from = anchorIndex >= 0 ? anchorIndex : index;
      setAnchor(ids[from] ?? null);
      const lo = Math.min(from, next);
      const hi = Math.max(from, next);
      const range = ids.slice(lo, hi + 1);
      if (additive) {
        // Union with what is already selected elsewhere in the list.
        setSelected((prev) => Array.from(new Set([...prev, ...range])));
      } else {
        setSelected(range);
      }
    } else {
      // Plain / Ctrl+Arrow moves the anchor without changing the selection.
      setAnchor(ids[next] ?? null);
    }
    const list = e.currentTarget.closest("ul");
    (
      list?.querySelector(`[data-row-index="${next}"]`) as HTMLElement | undefined
    )?.focus();
  }



  const bankTotal = txnIds.reduce(
    (sum, id) => sum + Math.abs(Number(transactions.find((t) => t.id === id)?.amount ?? 0)),
    0,
  );
  const ledgerTotal = recordIds.reduce(
    (sum, id) => sum + Math.abs(Number(records.find((r) => r.id === id)?.amount ?? 0)),
    0,
  );
  const difference = Number((bankTotal - ledgerTotal).toFixed(2));
  const canMerge = txnIds.length > 0 && recordIds.length > 0 && !merging;

  return (
    <section className="space-y-3">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <p className="caption">Side-by-side matching</p>
          <p className="text-xs text-muted-foreground">
            Tick one or more rows on each side, then reconcile them as a single merged match.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            Show open items only
          </label>
          <button
            onClick={onAiSuggest}
            disabled={running}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Working…" : "AI Suggest"}
          </button>
          <button
            onClick={() => onBulkAccept(txnIds)}
            disabled={!txnIds.length || merging}
            className="rounded-lg border border-success/50 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/20 disabled:opacity-40"
          >
            Accept selected ({txnIds.length})
          </button>
          <button
            onClick={() => onBulkReject(txnIds)}
            disabled={!txnIds.length || merging}
            className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-40"
          >
            Reject selected ({txnIds.length})
          </button>
          <button
            onClick={onBulkApprove}
            disabled={running || !pendingAutoCount}
            className="rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-40"
          >
            Bulk Approve Auto ({pendingAutoCount})
          </button>
        </div>
      </div>


      <div className="grid gap-3 lg:grid-cols-2">
        {/* bank side */}
        <div className="panel flex flex-col p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="caption">Bank statement · {bankRows.length}</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setBankFilterOpen((o) => !o)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                  bankFilter
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border-strong hover:border-primary"
                }`}
              >
                Filter{bankFilter ? " •" : ""}
              </button>
              <input
                className="field max-w-[10rem]"
                placeholder="Search ref, narration, remarks, date…"
                value={bankQuery}
                onChange={(e) => setBankQuery(e.target.value)}
              />
            </div>
          </div>
          {bankFilterOpen && (
            <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
              <label className="caption">Filter by narration words</label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  className="field flex-1"
                  placeholder="e.g. transfer, charge, nip fee"
                  value={bankFilterDraft}
                  onChange={(e) => setBankFilterDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setBankFilter(bankFilterDraft);
                      setBankFilterMode(bankFilterModeDraft);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    setBankFilter(bankFilterDraft);
                    setBankFilterMode(bankFilterModeDraft);
                  }}
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setBankFilterDraft("");
                    setBankFilter("");
                  }}
                  className="rounded-lg border border-border-strong px-2.5 py-1.5 text-[11px] font-semibold hover:border-primary"
                >
                  Clear
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={bankFilterModeDraft === "any"}
                    onChange={() => setBankFilterModeDraft("any")}
                  />
                  Match any term
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={bankFilterModeDraft === "all"}
                    onChange={() => setBankFilterModeDraft("all")}
                  />
                  Match all terms
                </label>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Separate terms with commas. Words inside a term must all appear together.
              </p>
            </div>
          )}


          <label className="mt-2 flex items-center gap-2 border-b border-border pb-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={allBankSelected}
              onChange={toggleAllBank}
              disabled={!bankRows.length}
            />
            Select all visible ({bankRows.length})
            {txnIds.length > 0 && (
              <span className="mono ml-auto text-[10px]">{txnIds.length} selected</span>
            )}
          </label>
          <ul className="mt-2 max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
            {bankRows.map((txn, rowIndex) => {
              const suggestion = suggestions[txn.id];
              const badge = txn.status === "reconciled" ? "reconciled" : txn.category;
              const meta = badge ? CATEGORY_META[badge] : null;
              const selected = txnIds.includes(txn.id);
              return (
                <li
                  key={txn.id}
                  tabIndex={0}
                  data-row-index={rowIndex}
                  onMouseDown={() => setBankAnchor(txn.id)}
                  onKeyDown={(e) =>
                    rowKeyDown(
                      e,
                      rowIndex,
                      bankRows.map((r) => r.id),
                      bankAnchor,
                      setBankAnchor,
                      setTxnIds,
                    )
                  }
                  className={`rounded-md border bg-background px-2.5 py-2 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    selected ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                >

                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected}
                      onChange={() => {
                        setBankAnchor(txn.id);
                        setTxnIds((s) => toggle(s, txn.id));
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="mono truncate text-xs">{txn.txn_ref}</p>
                        <p
                          className={`mono text-xs font-semibold ${
                            txn.direction === "credit" ? "text-success" : "text-destructive"
                          }`}
                        >
                          {txn.direction === "credit" ? "+" : "−"}
                          {formatAmount(txn.amount, currency)}
                        </p>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {txn.narration ?? "—"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="mono text-[10px] text-muted-foreground">
                          {formatDate(txn.txn_date)}
                        </span>
                        {meta && (
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${TONE_CLASS[meta.tone]}`}
                          >
                            {meta.label}
                          </span>
                        )}
                        {suggestion?.accounting_record_id && (
                          <span className="mono text-[10px] text-primary">
                            →{" "}
                            {records.find((r) => r.id === suggestion.accounting_record_id)
                              ?.doc_number ?? "—"}{" "}
                            · {Number(suggestion.confidence).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {txn.status === "unreconciled" && suggestion && (
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            disabled={busyId === txn.id}
                            onClick={() => onAccept(txn, suggestion.accounting_record_id)}
                            className="rounded border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success disabled:opacity-50"
                          >
                            Accept match
                          </button>
                          <button
                            disabled={busyId === txn.id}
                            onClick={() => onReject(txn)}
                            className="rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {!bankRows.length && (
              <li className="py-6 text-center text-xs text-muted-foreground">
                No bank transactions to show.
              </li>
            )}
          </ul>
        </div>

        {/* ledger side */}
        <div className="panel flex flex-col p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="caption">ERP ledger · {ledgerRows.length}</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setLedgerFilterOpen((o) => !o)}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                  ledgerFilter
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border-strong hover:border-primary"
                }`}
              >
                Filter{ledgerFilter ? " •" : ""}
              </button>
              <input
                className="field max-w-[10rem]"
                placeholder="Search ref, party, remarks, date…"
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
              />
            </div>
          </div>
          {ledgerFilterOpen && (
            <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
              <label className="caption">Filter by remarks words</label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  className="field flex-1"
                  placeholder="e.g. salary july, rent, vat"
                  value={ledgerFilterDraft}
                  onChange={(e) => setLedgerFilterDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setLedgerFilter(ledgerFilterDraft);
                      setLedgerFilterMode(ledgerFilterModeDraft);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    setLedgerFilter(ledgerFilterDraft);
                    setLedgerFilterMode(ledgerFilterModeDraft);
                  }}
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setLedgerFilterDraft("");
                    setLedgerFilter("");
                  }}
                  className="rounded-lg border border-border-strong px-2.5 py-1.5 text-[11px] font-semibold hover:border-primary"
                >
                  Clear
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={ledgerFilterModeDraft === "any"}
                    onChange={() => setLedgerFilterModeDraft("any")}
                  />
                  Match any term
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={ledgerFilterModeDraft === "all"}
                    onChange={() => setLedgerFilterModeDraft("all")}
                  />
                  Match all terms
                </label>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Separate terms with commas. Words inside a term must all appear together.
              </p>

            </div>
          )}

          <label className="mt-2 flex items-center gap-2 border-b border-border pb-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={allLedgerSelected}
              onChange={toggleAllLedger}
              disabled={!ledgerRows.length}
            />
            Select all visible ({ledgerRows.length})
            {recordIds.length > 0 && (
              <span className="mono ml-auto text-[10px]">{recordIds.length} selected</span>
            )}
          </label>
          <ul className="mt-2 max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
            {ledgerRows.map((record, rowIndex) => {
              const selected = recordIds.includes(record.id);
              const status = record.status ?? "open";
              return (
                <li
                  key={record.id}
                  tabIndex={0}
                  data-row-index={rowIndex}
                  onMouseDown={() => setLedgerAnchor(record.id)}
                  onKeyDown={(e) =>
                    rowKeyDown(
                      e,
                      rowIndex,
                      ledgerRows.map((r) => r.id),
                      ledgerAnchor,
                      setLedgerAnchor,
                      setRecordIds,
                    )
                  }
                  className={`rounded-md border bg-background px-2.5 py-2 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    selected ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected}
                      onChange={() => {
                        setLedgerAnchor(record.id);
                        setRecordIds((s) => toggle(s, record.id));
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="mono truncate text-xs">{record.doc_number}</p>
                        <p
                          className={`mono text-xs font-semibold ${
                            record.side === "credit" ? "text-success" : "text-destructive"
                          }`}
                        >
                          {formatAmount(record.amount, currency)}
                        </p>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {record.party_name ?? "—"}
                        {(() => {
                          const remarks = (record.meta?.Remarks ?? record.meta?.remarks) as
                            | string
                            | undefined;
                          return remarks ? ` · ${remarks}` : "";
                        })()}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="mono text-[10px] text-muted-foreground">
                          {formatDate(record.doc_date)} · {record.side}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                            status === "reconciled"
                              ? TONE_CLASS.success
                              : status === "rejected"
                                ? TONE_CLASS.destructive
                                : TONE_CLASS.muted
                          }`}
                        >
                          {status}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {!ledgerRows.length && (
              <li className="py-6 text-center text-xs text-muted-foreground">
                No ledger records to show.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* merge bar */}
      <div className="panel flex flex-wrap items-end justify-between gap-3 p-3">
        <div className="flex flex-wrap gap-4 text-xs">
          <div>
            <p className="caption">Bank selected</p>
            <p className="mono">
              {txnIds.length} · {formatAmount(bankTotal, currency)}
            </p>
          </div>
          <div>
            <p className="caption">Ledger selected</p>
            <p className="mono">
              {recordIds.length} · {formatAmount(ledgerTotal, currency)}
            </p>
          </div>
          <div>
            <p className="caption">Difference</p>
            <p
              className={`mono font-semibold ${
                Math.abs(difference) < 0.01 ? "text-success" : "text-warning"
              }`}
            >
              {formatAmount(difference, currency)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="caption">Note</label>
            <input
              className="field mt-1 w-52"
              placeholder="e.g. part payment split"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              setTxnIds([]);
              setRecordIds([]);
              setNote("");
            }}
            className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
          >
            Clear selection
          </button>
          <button
            disabled={!canMerge}
            onClick={() => {
              onMerge(txnIds, recordIds, note);
              setTxnIds([]);
              setRecordIds([]);
              setNote("");
            }}
            className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-40"
          >
            {merging
              ? "Reconciling…"
              : `Reconcile merged (${txnIds.length} ↔ ${recordIds.length})`}
          </button>
        </div>
      </div>
    </section>
  );
}
