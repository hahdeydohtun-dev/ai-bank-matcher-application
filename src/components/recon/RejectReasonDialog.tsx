import { useEffect, useState } from "react";

export type RejectPrompt = {
  scope: "single" | "bulk";
  ids: string[];
  label?: string;
};

const QUICK_REASONS = [
  "Duplicate transaction",
  "Wrong counterparty",
  "Amount mismatch",
  "Date out of period",
  "Reversed / voided",
  "Manual match required",
  "Not our transaction",
];

const LAST_REASONS_KEY = "recon.reject-reasons.recent.v1";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LAST_REASONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 5).filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(reason: string) {
  if (typeof window === "undefined") return;
  const clean = reason.trim();
  if (!clean) return;
  const prev = loadRecent().filter((r) => r !== clean);
  const next = [clean, ...prev].slice(0, 5);
  try {
    window.localStorage.setItem(LAST_REASONS_KEY, JSON.stringify(next));
  } catch {}
}

export function RejectReasonDialog({
  prompt,
  onCancel,
  onConfirm,
  busy,
}: {
  prompt: RejectPrompt | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (prompt) {
      setReason("");
      setRecent(loadRecent());
    }
  }, [prompt]);

  if (!prompt) return null;

  const count = prompt.ids.length;
  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  function submit() {
    if (!canSubmit) return;
    saveRecent(trimmed);
    onConfirm(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-reason-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border-strong bg-card shadow-xl">
        <div className="border-b border-border-strong px-4 py-3">
          <h2 id="reject-reason-title" className="text-sm font-semibold">
            {prompt.scope === "bulk"
              ? `Reject ${count} suggestion${count === 1 ? "" : "s"}`
              : "Reject suggestion"}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A reason is required and will be saved on {prompt.scope === "bulk" ? "each rejected item" : "this rejection"}.
          </p>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Quick reasons
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setReason(q)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    reason === q
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border-strong text-muted-foreground hover:border-primary hover:text-foreground"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {recent.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recent
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setReason(q)}
                    className="rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Rejection reason
            </label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this match is being rejected…"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-md border border-border-strong bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>Saved on each rejected suggestion for audit.</span>
              <span>{trimmed.length}/500</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-strong px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border-strong px-3 py-1.5 text-[11px] font-semibold hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-destructive px-3 py-1.5 text-[11px] font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-40"
          >
            {busy
              ? "Rejecting…"
              : prompt.scope === "bulk"
                ? `Reject ${count} with reason`
                : "Reject with reason"}
          </button>
        </div>
      </div>
    </div>
  );
}
