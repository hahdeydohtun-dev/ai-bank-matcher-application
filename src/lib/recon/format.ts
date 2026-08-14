export const CATEGORY_META: Record<
  string,
  { label: string; tone: "primary" | "success" | "warning" | "destructive" | "flag" | "muted" }
> = {
  auto: { label: "Auto-matched", tone: "success" },
  review: { label: "Needs review", tone: "warning" },
  unmatched: { label: "Unmatched", tone: "destructive" },
  highvalue: { label: "High value", tone: "flag" },
  duplicate: { label: "Duplicate", tone: "flag" },
  aging: { label: "Aging", tone: "warning" },
  reconciled: { label: "Reconciled", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
};

export const TONE_CLASS: Record<string, string> = {
  primary: "bg-primary/12 text-primary border-primary/35",
  success: "bg-success/12 text-success border-success/35",
  warning: "bg-warning/12 text-warning border-warning/35",
  destructive: "bg-destructive/12 text-destructive border-destructive/35",
  flag: "bg-flag/12 text-flag border-flag/35",
  muted: "bg-muted text-muted-foreground border-border-strong",
};

export function formatAmount(value: number | string | null, currency = "NGN") {
  const n = Number(value ?? 0);
  const symbol = currency === "NGN" ? "\u20a6" : "";
  return `${symbol}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
