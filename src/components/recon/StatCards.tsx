import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/recon/format";

export type StatKey =
  | "total"
  | "auto"
  | "review"
  | "unmatched"
  | "highvalue"
  | "duplicate"
  | "aging"
  | "reconciled";

export const STAT_DEFS: { key: StatKey; label: string; tone: string }[] = [
  { key: "total", label: "Total transactions", tone: "text-foreground" },
  { key: "auto", label: "Auto-matched", tone: "text-success" },
  { key: "review", label: "Pending review", tone: "text-warning" },
  { key: "unmatched", label: "Unmatched", tone: "text-destructive" },
  { key: "highvalue", label: "High value", tone: "text-destructive" },
  { key: "duplicate", label: "Duplicates", tone: "text-destructive" },
  { key: "aging", label: "Aging", tone: "text-warning" },
  { key: "reconciled", label: "Reconciled", tone: "text-success" },
];

export function StatCards({
  counts,
  values,
  active,
  currency,
  onSelect,
}: {
  counts: Record<StatKey, number>;
  values: Record<StatKey, number>;
  active: StatKey;
  currency: string;
  onSelect: (key: StatKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-0 border-y border-border bg-surface sm:grid-cols-4 xl:grid-cols-8">
      {STAT_DEFS.map((def) => {
        const isActive = active === def.key;
        return (
          <Button variant="ghost"
            key={def.key}
            onClick={() => onSelect(def.key)}
            className={`h-auto min-w-0 flex-col items-start gap-0 rounded-none border-r border-border px-3 py-2 text-left transition-colors hover:bg-primary/5 ${
              isActive ? "bg-primary/5 shadow-[inset_0_-2px_0_var(--primary)]" : ""
            }`}
          >
            <p className="caption whitespace-normal">{def.label}</p>
            <p className={`mono mt-1 text-xl font-semibold ${isActive ? "text-primary" : def.tone}`}>
              {counts[def.key] ?? 0}
            </p>
            <p className="mono mt-0.5 w-full truncate text-[10px] text-muted-foreground">
              {formatAmount(values[def.key] ?? 0, currency)}
            </p>
          </Button>
        );
      })}
    </div>
  );
}
