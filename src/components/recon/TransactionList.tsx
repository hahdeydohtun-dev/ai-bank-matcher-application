import type { BankTransaction } from "@/lib/recon/db";
import { CATEGORY_META, TONE_CLASS, formatAmount, formatDate } from "@/lib/recon/format";

function StatusBadge({ txn }: { txn: BankTransaction }) {
  const key =
    txn.status === "reconciled"
      ? "reconciled"
      : txn.status === "rejected"
        ? "rejected"
        : (txn.category ?? null);

  if (!key) {
    return (
      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CLASS.muted}`}>
        Unreconciled
      </span>
    );
  }
  const meta = CATEGORY_META[key];
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CLASS[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

export function TransactionList({
  transactions,
  currency,
  selectedId,
  onSelect,
}: {
  transactions: BankTransaction[];
  currency: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!transactions.length) {
    return (
      <div className="panel p-8 text-center text-sm text-muted-foreground">
        No transactions match the current filters.
      </div>
    );
  }

  return (
    <div className="panel divide-y divide-border overflow-hidden">
      {transactions.map((txn) => (
        <button
          key={txn.id}
          onClick={() => onSelect(txn.id)}
          className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2 sm:flex-row sm:items-center ${
            selectedId === txn.id ? "bg-surface-2" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-xs text-primary">{txn.txn_ref}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  txn.direction === "credit"
                    ? TONE_CLASS.success
                    : TONE_CLASS.destructive
                }`}
              >
                {txn.direction === "credit" ? "IN" : "OUT"}
              </span>
              <span className="mono text-[11px] text-muted-foreground">
                {formatDate(txn.txn_date)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{txn.narration}</p>
          </div>

          <div className="flex items-center gap-4 sm:justify-end">
            <span
              className={`mono text-sm font-semibold ${
                txn.direction === "credit" ? "text-success" : "text-foreground"
              }`}
            >
              {formatAmount(txn.amount, currency)}
            </span>
            <div className="flex min-w-[9rem] flex-col items-start gap-0.5 sm:items-end">
              <StatusBadge txn={txn} />
              {txn.resolved_by_email && (
                <span className="text-[10px] text-muted-foreground">
                  by {txn.resolved_by_email}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
