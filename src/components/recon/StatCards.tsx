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
  { key: "total", label: "Total", tone: "text-foreground" },
  { key: "auto", label: "Auto", tone: "text-success" },
  { key: "review", label: "Review", tone: "text-warning" },
  { key: "unmatched", label: "Unmatched", tone: "text-destructive" },
  { key: "highvalue", label: "High-Val", tone: "text-flag" },
  { key: "duplicate", label: "Dupes", tone: "text-flag" },
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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {STAT_DEFS.map((def) => {
        const isActive = active === def.key;
        return (
          <button
            key={def.key}
            onClick={() => onSelect(def.key)}
            className={`panel px-3 py-2.5 text-left transition-colors hover:border-primary/60 ${
              isActive ? "border-primary ring-1 ring-primary/40" : ""
            }`}
          >
            <p className="caption">{def.label}</p>
            <p className={`mono mt-1 text-lg font-semibold ${def.tone}`}>
              {counts[def.key] ?? 0}
            </p>
            <p className="mono mt-0.5 truncate text-[10px] text-muted-foreground">
              {formatAmount(values[def.key] ?? 0, currency)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
