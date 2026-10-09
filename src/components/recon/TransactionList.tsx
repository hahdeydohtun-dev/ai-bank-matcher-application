import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Search, X, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AccountingRecord, BankTransaction, MatchSuggestion } from "@/lib/recon/db";
import { CATEGORY_META, TONE_CLASS, formatAmount, formatDate } from "@/lib/recon/format";
import { scopedSelection, selectablePageIds } from "@/lib/recon/tableSelection";

function StatusBadge({ txn }: { txn: BankTransaction }) {
  const key = txn.status === "reconciled" ? "reconciled" : txn.status === "rejected" ? "rejected" : txn.category;
  const meta = key ? CATEGORY_META[key] : null;
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE_CLASS[meta?.tone ?? "muted"]}`}><span className="size-1 rounded-full bg-current" />{meta?.label ?? "Unreconciled"}</span>;
}

type SortKey = "txn_date" | "txn_ref" | "amount" | "balance";
export function TransactionList({ transactions, currency, selectedId, onSelect, suggestions = {}, records = {}, pageSize = 200, running = false, busyId, onAccept, onReject, onBulkAccept, onBulkReject, history = false }: {
  transactions: BankTransaction[]; currency: string; selectedId: string | null; onSelect: (id: string) => void;
  suggestions?: Record<string, MatchSuggestion>; records?: Record<string, AccountingRecord>; pageSize?: number; running?: boolean; busyId?: string | null;
  onAccept?: (txn: BankTransaction) => void; onReject?: (txn: BankTransaction) => void;
  onBulkAccept?: (ids: string[]) => void; onBulkReject?: (ids: string[]) => void; history?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("all");
  const [status, setStatus] = useState("all");
  const [confidence, setConfidence] = useState("");
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "txn_date", ascending: false });
  const rows = useMemo(() => transactions.filter(t => {
    if (direction !== "all" && t.direction !== direction) return false;
    if (status !== "all" && t.status !== status) return false;
    const score = t.ai_confidence ?? suggestions[t.id]?.confidence;
    if (confidence !== "" && (score == null || Number(score) < Number(confidence))) return false;
    return `${t.txn_ref} ${t.narration ?? ""}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    const result = sort.key === "amount" || sort.key === "balance" ? Number(av ?? 0) - Number(bv ?? 0) : String(av ?? "").localeCompare(String(bv ?? ""));
    return sort.ascending ? result : -result;
  }), [transactions, query, direction, status, confidence, suggestions, sort]);
  const size = Math.max(1, pageSize);
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  const pageRows = rows.slice(current * size, (current + 1) * size);
  const eligible = selectablePageIds(pageRows);
  const selected = scopedSelection(checked, eligible);
  const allChecked = eligible.length > 0 && selected.length === eligible.length;
  function changeFilter(set: (value: string) => void, value: string) { set(value); setPage(0); setChecked([]); }
  function sortBy(key: SortKey) { setSort(s => ({key, ascending: s.key === key ? !s.ascending : true})); setChecked([]); }
  const header = (key: SortKey, label: string, right = false) => <th aria-sort={sort.key === key ? sort.ascending ? "ascending" : "descending" : "none"} className={right ? "text-right" : ""}><Button variant="ghost" size="sm" className={`h-auto px-0 py-0 text-[11px] ${right ? "w-full justify-end" : ""}`} onClick={() => sortBy(key)}>{label}{sort.key === key && (sort.ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</Button></th>;
  return <section aria-label={history ? "Resolution history" : "Bank transaction table"}>
    <div className="flex flex-wrap items-center gap-2 py-3">
      <div className="relative min-w-48 flex-1"><Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" /><input aria-label="Search bank transactions" type="search" className="field pl-8" placeholder="Search description or reference…" value={query} onChange={e => changeFilter(setQuery, e.target.value)} /></div>
      <select aria-label="Transaction status" className="field w-auto" value={status} onChange={e => changeFilter(setStatus, e.target.value)}><option value="all">All statuses</option><option value="unreconciled">Unreconciled</option><option value="reconciled">Reconciled</option><option value="rejected">Rejected</option></select>
      <select aria-label="Transaction type" className="field w-auto" value={direction} onChange={e => changeFilter(setDirection, e.target.value)}><option value="all">All transaction types</option><option value="credit">Deposits</option><option value="debit">Withdrawals</option></select>
      {!history && <input aria-label="Minimum AI confidence" type="number" min="0" max="100" className="field w-32" placeholder="Min. confidence %" value={confidence} onChange={e => changeFilter(setConfidence, e.target.value)} />}
    </div>
    {selected.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 border border-primary/25 bg-primary/5 px-3 py-2"><span className="text-xs font-medium text-primary">{selected.length} selected on this page</span><Button variant="outline" size="sm" disabled={running} onClick={() => onBulkAccept?.(selected)}><Check />Accept selected</Button><Button variant="ghost" size="sm" disabled={running} onClick={() => onBulkReject?.(selected)}><X />Reject selected</Button><Button variant="ghost" size="sm" onClick={() => setChecked([])}>Clear selection</Button></div>}
    <div className="erp-grid-scroll"><table className="erp-grid"><thead><tr>
      {!history && <th className="w-8"><input type="checkbox" aria-label="Select eligible transactions on current page" checked={allChecked} disabled={!eligible.length} ref={el => {if (el) el.indeterminate = selected.length > 0 && !allChecked;}} onChange={() => setChecked(allChecked ? [] : eligible)} /></th>}
      {header("txn_date", "Date")}<th>Description / narration</th>{header("amount", "Deposit", true)}<th className="text-right">Withdrawal</th>{header("balance", "Running balance", true)}{header("txn_ref", "Reference")}<th>Status</th><th className="text-right">AI confidence</th><th>ERP entry</th>{history && <><th>Resolved by</th><th>Resolved at</th><th>Reason</th></>}<th>Actions</th>
    </tr></thead><tbody>{pageRows.map(txn => {
      const suggestion = suggestions[txn.id];
      const linkedId = txn.reconciled_record_id ?? suggestion?.accounting_record_id;
      const record = linkedId ? records[linkedId] : null;
      const score = txn.ai_confidence ?? suggestion?.confidence;
      const selectable = eligible.includes(txn.id);
      return <tr key={txn.id} className={selectedId === txn.id || selected.includes(txn.id) ? "bg-primary/5" : ""}>
        {!history && <td><input type="checkbox" aria-label={`Select transaction ${txn.txn_ref}`} checked={selected.includes(txn.id)} disabled={!selectable} onChange={() => setChecked(selected.includes(txn.id) ? selected.filter(id => id !== txn.id) : [...selected, txn.id])} /></td>}
        <td>{formatDate(txn.txn_date)}</td><td className="max-w-64"><p className="truncate" title={txn.narration || undefined}>{txn.narration || "—"}</p></td><td className="mono text-right text-success">{txn.direction === "credit" ? formatAmount(txn.amount, currency) : "—"}</td><td className="mono text-right">{txn.direction !== "credit" ? formatAmount(txn.amount, currency) : "—"}</td><td className="mono text-right">{txn.balance === null ? "—" : formatAmount(txn.balance, currency)}</td><td><Button variant="link" size="sm" className="mono h-auto p-0 text-xs" onClick={() => onSelect(txn.id)}>{txn.txn_ref}</Button></td><td><StatusBadge txn={txn} /></td><td className="mono text-right text-muted-foreground">{score == null ? "—" : `${Number(score).toFixed(0)}%`}</td><td className="mono text-xs">{record?.doc_number ?? (txn.match_group_id ? "Merged match" : "—")}</td>
        {history && <><td>{txn.resolved_by_email || "—"}</td><td>{formatDate(txn.resolved_at)}</td><td className="max-w-48"><p className="truncate" title={txn.rejection_reason || undefined}>{txn.rejection_reason || "—"}</p></td></>}
        <td><div className="flex items-center gap-0.5"><Button variant="ghost" size="icon" className="size-7" title="Review transaction" aria-label={`Review ${txn.txn_ref}`} onClick={() => onSelect(txn.id)}><Eye /></Button>{!history && selectable && suggestion && <><Button variant="ghost" size="icon" className="size-7 text-success" title="Accept match" aria-label={`Accept ${txn.txn_ref}`} disabled={running || busyId === txn.id} onClick={() => onAccept?.(txn)}><Check /></Button><Button variant="ghost" size="icon" className="size-7 text-destructive" title="Reject match" aria-label={`Reject ${txn.txn_ref}`} disabled={running || busyId === txn.id} onClick={() => onReject?.(txn)}><X /></Button></>}</div></td>
      </tr>;
    })}{!pageRows.length && <tr><td colSpan={history ? 13 : 11} className="h-40 text-center text-muted-foreground">No transactions match the current filters.</td></tr>}</tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-xs text-muted-foreground"><span>{rows.length ? `${current * size + 1}–${Math.min((current + 1) * size, rows.length)} of ${rows.length}` : "0"} transactions · {currency}</span><div className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label="Previous transaction page" disabled={current === 0} onClick={() => {setPage(current - 1);setChecked([]);}}><ChevronLeft /></Button><span>Page {current + 1} of {Math.max(1, Math.ceil(rows.length / size))}</span><Button variant="ghost" size="icon" aria-label="Next transaction page" disabled={(current + 1) * size >= rows.length} onClick={() => {setPage(current + 1);setChecked([]);}}><ChevronRight /></Button></div></div>
  </section>;
}
