import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountingRecord, BankTransaction, MatchSuggestion } from "@/lib/recon/db";
import { CATEGORY_META, TONE_CLASS, formatAmount, formatDate } from "@/lib/recon/format";
import { STAT_DEFS, type StatKey } from "./StatCards";

function confidenceTone(value: number) {
  if (value >= 85) return TONE_CLASS.success;
  if (value >= 60) return TONE_CLASS.warning;
  return TONE_CLASS.destructive;
}

function scoreTone(value: number) {
  if (value >= 85) return TONE_CLASS.success;
  if (value >= 60) return TONE_CLASS.warning;
  if (value >= 30) return TONE_CLASS.flag;
  return TONE_CLASS.destructive;
}

const FLAG_NOTES: Record<string, string> = {
  duplicate: "Possible duplicate — this ledger record was already claimed by a stronger match.",
  aging: "Aging item — unmatched and older than 14 days.",
  highvalue: "High-value item — above ₦3,000,000, review before approving.",
  unmatched: "No confident ledger candidate found for this line.",
};

type Thresholds = {
  amount: number;
  reference: number;
  date: number;
  party: number;
  side: number;
};

const THRESHOLD_KEY = "recon.suggestion-thresholds.v1";
const DEFAULT_THRESHOLDS: Thresholds = {
  amount: 0,
  reference: 0,
  date: 0,
  party: 0,
  side: 0,
};

function loadThresholds(): Thresholds {
  if (typeof window === "undefined") return DEFAULT_THRESHOLDS;
  try {
    const raw = window.localStorage.getItem(THRESHOLD_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

const THRESHOLD_DEFS: { key: keyof Thresholds; label: string; scoreKey: keyof MatchSuggestion }[] = [
  { key: "amount", label: "AMT", scoreKey: "amount_score" },
  { key: "reference", label: "REF", scoreKey: "reference_score" },
  { key: "date", label: "DATE", scoreKey: "date_score" },
  { key: "party", label: "PARTY", scoreKey: "party_score" },
  { key: "side", label: "SIDE", scoreKey: "side_score" },
];

export function SuggestionsPanel({
  transactions,
  suggestions,
  records,
  currency,
  activeCategory,
  counts,
  selectedId,
  onSelectCategory,
  onAccept,
  onReject,
  onBulkAccept,
  onBulkReject,
  onBulkApproveAuto,
  onUndoLastBulk,
  undoLabel,
  pendingAutoCount,
  running,
  busyId,
}: {
  transactions: BankTransaction[];
  suggestions: Record<string, MatchSuggestion>;
  records: Record<string, AccountingRecord>;
  currency: string;
  activeCategory: StatKey;
  counts: Record<StatKey, number>;
  selectedId: string | null;
  onSelectCategory: (key: StatKey) => void;
  onAccept: (txn: BankTransaction) => void;
  onReject: (txn: BankTransaction) => void;
  onBulkAccept?: (ids: string[]) => void;
  onBulkReject?: (ids: string[]) => void;
  onBulkApproveAuto?: () => void;
  onUndoLastBulk?: () => void;
  undoLabel?: string | null;
  pendingAutoCount?: number;
  running?: boolean;
  busyId: string | null;
}) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [showFilters, setShowFilters] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setThresholds(loadThresholds());
  }, []);

  const updateThreshold = (key: keyof Thresholds, value: number) => {
    const next = { ...thresholds, [key]: value };
    setThresholds(next);
    try {
      window.localStorage.setItem(THRESHOLD_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const resetThresholds = () => {
    setThresholds(DEFAULT_THRESHOLDS);
    try {
      window.localStorage.setItem(THRESHOLD_KEY, JSON.stringify(DEFAULT_THRESHOLDS));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (selectedId && refs.current[selectedId]) {
      refs.current[selectedId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedId]);

  const feed = useMemo(() => {
    const sorted = [...transactions].sort(
      (a, b) => Number(b.ai_confidence ?? -1) - Number(a.ai_confidence ?? -1),
    );
    return sorted.filter((txn) => {
      const s = suggestions[txn.id];
      // Only filter rows that have a suggestion; keep bare rows visible when all thresholds are 0.
      const anyActive = THRESHOLD_DEFS.some((d) => thresholds[d.key] > 0);
      if (!anyActive) return true;
      if (!s) return false;
      return THRESHOLD_DEFS.every(
        (d) => Number(s[d.scoreKey] ?? 0) >= thresholds[d.key],
      );
    });
  }, [transactions, suggestions, thresholds]);

  const visibleIds = useMemo(() => feed.map((t) => t.id), [feed]);

  // Auto-deselect rows that are no longer visible after filter/search changes.
  useEffect(() => {
    setChecked((prev) => {
      const visible = new Set(visibleIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleIds]);

  const selectable = feed.filter((t) => t.status !== "reconciled" && t.status !== "rejected");
  const selectableIds = selectable.map((t) => t.id);
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => checked.has(id));
  const someChecked = checked.size > 0 && !allChecked;

  const toggleAll = () => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(selectableIds));
  };

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = Array.from(checked);

  return (
    <aside className="panel flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="caption">AI Suggestions</p>
        <p className="mono mt-1 text-sm font-semibold text-primary">
          {feed.length} SIGNALS · {currency}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {STAT_DEFS.map((def) => (
            <button
              key={def.key}
              onClick={() => onSelectCategory(def.key)}
              className={`rounded-md border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                activeCategory === def.key
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border-strong text-muted-foreground hover:border-primary/50"
              }`}
            >
              {def.label} {counts[def.key] ?? 0}
            </button>
          ))}
        </div>

        {/* filters toggle */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="rounded-md border border-border-strong px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:border-primary hover:text-primary"
          >
            {showFilters ? "Hide filters" : "Filters"}
          </button>
          {THRESHOLD_DEFS.some((d) => thresholds[d.key] > 0) && (
            <button
              onClick={resetThresholds}
              className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-destructive"
            >
              Reset
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-2 space-y-2 rounded-md border border-border bg-background/60 p-2">
            {THRESHOLD_DEFS.map((d) => (
              <div key={d.key} className="flex items-center gap-2">
                <span className="mono w-12 text-[10px] font-semibold text-muted-foreground">
                  {d.label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={thresholds[d.key]}
                  onChange={(e) => updateThreshold(d.key, Number(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={thresholds[d.key]}
                  onChange={(e) =>
                    updateThreshold(
                      d.key,
                      Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    )
                  }
                  className="field h-6 w-14 text-[11px]"
                />
                <span className="text-[10px] text-muted-foreground">%</span>
              </div>
            ))}
          </div>
        )}

        {/* bulk toolbar */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = someChecked;
              }}
              onChange={toggleAll}
              disabled={!selectableIds.length}
            />
            Select all visible ({selectableIds.length})
          </label>
          <span className="text-[10px] text-muted-foreground">{selectedIds.length} selected</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => onBulkAccept?.(selectedIds)}
            disabled={!selectedIds.length || running}
            className="flex-1 rounded-md bg-success px-2 py-1 text-[10px] font-semibold text-success-foreground hover:opacity-90 disabled:opacity-40"
          >
            Accept selected
          </button>
          <button
            onClick={() => onBulkReject?.(selectedIds)}
            disabled={!selectedIds.length || running}
            className="flex-1 rounded-md border border-destructive/50 px-2 py-1 text-[10px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            Reject selected
          </button>
          <button
            onClick={() => onBulkApproveAuto?.()}
            disabled={!pendingAutoCount || running}
            className="flex-1 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            Bulk Approve Auto ({pendingAutoCount ?? 0})
          </button>
        </div>
        {undoLabel && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border-strong bg-background/60 px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Last action: {undoLabel}
            </span>
            <button
              onClick={() => onUndoLastBulk?.()}
              disabled={running}
              className="rounded-md border border-primary/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              Undo
            </button>
          </div>
        )}
      </div>


      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!feed.length && (
          <p className="p-6 text-center text-xs text-muted-foreground">
            No signals in this view. Run AI Suggest to score the current statement, or lower the filter thresholds.
          </p>
        )}

        {feed.map((txn) => {
          const suggestion = suggestions[txn.id];
          const record = suggestion?.accounting_record_id
            ? records[suggestion.accounting_record_id]
            : null;
          const confidence = Number(txn.ai_confidence ?? suggestion?.confidence ?? 0);
          const resolved = txn.status === "reconciled" || txn.status === "rejected";
          const categoryMeta = txn.category ? CATEGORY_META[txn.category] : null;
          const isChecked = checked.has(txn.id);

          return (
            <div
              key={txn.id}
              ref={(el) => {
                refs.current[txn.id] = el;
              }}
              className={`panel-2 p-3 transition-all ${resolved ? "opacity-55" : ""} ${
                selectedId === txn.id ? "ring-1 ring-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  {!resolved && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleOne(txn.id)}
                      className="mt-1"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="mono truncate text-xs text-primary">{txn.txn_ref}</p>
                    <p className="mono mt-1 text-sm font-semibold">
                      {formatAmount(txn.amount, currency)}
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        {formatDate(txn.txn_date)}
                      </span>
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold ${confidenceTone(confidence)}`}
                >
                  {confidence.toFixed(0)}%
                </span>
              </div>

              <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">
                {txn.narration}
              </p>

              {record ? (
                <div className="mt-2 rounded-lg border border-border bg-background/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[11px] text-foreground">
                      {record.doc_number}
                    </span>
                    <span className={`rounded border px-1.5 text-[10px] ${TONE_CLASS.primary}`}>
                      1:1
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {record.party_name} · {formatDate(record.doc_date)}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">No matched record.</p>
              )}

              {suggestion && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {([
                    ["AMT", Number(suggestion.amount_score) || 0],
                    ["REF", Number(suggestion.reference_score) || 0],
                    ["DATE", Number(suggestion.date_score) || 0],
                    ["PARTY", Number(suggestion.party_score) || 0],
                    ["SIDE", Number(suggestion.side_score) || 0],
                  ] as Array<[string, number]>).map(([label, value]) => (
                    <span
                      key={label}
                      className={`mono rounded border px-1.5 py-0.5 text-[10px] font-semibold ${scoreTone(value)}`}
                    >
                      {label} {value.toFixed(0)}%
                    </span>
                  ))}
                </div>
              )}


              {txn.category && FLAG_NOTES[txn.category] && (
                <p
                  className={`mt-2 rounded-md border px-2 py-1 text-[10px] ${TONE_CLASS[categoryMeta?.tone ?? "muted"]}`}
                >
                  {FLAG_NOTES[txn.category]}
                </p>
              )}

              {resolved ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-muted-foreground">
                    {txn.status === "reconciled" ? "Accepted" : "Rejected"} by{" "}
                    {txn.resolved_by_email ?? "teammate"}
                  </p>
                  {txn.status === "rejected" && txn.rejection_reason && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
                      <span className="font-semibold uppercase tracking-wide">Reason:</span>{" "}
                      {txn.rejection_reason}
                    </p>
                  )}
                </div>

              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busyId === txn.id}
                    onClick={() => onAccept(txn)}
                    className="flex-1 rounded-md bg-success px-2 py-1.5 text-[11px] font-semibold text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    disabled={busyId === txn.id}
                    onClick={() => onReject(txn)}
                    className="flex-1 rounded-md border border-destructive/50 px-2 py-1.5 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
