/**
 * Client-side helpers for the Import data dialog:
 *  - field-mapping presets saved per company + bank/ERP account + source
 *    (stored in `import_mapping_presets`, shared by everyone on the company —
 *    previously localStorage, which meant a colleague on another machine
 *    never saw your saved mapping)
 *  - last-run import status (steps, errors, skipped rows) for the retry panel
 *  - idempotency keys so repeated fetches never ingest the same period twice
 */

import { db } from "./db";

export type ImportSource = "csv" | "bank_api" | "erp_api";
export type ImportFormat = "bank" | "ledger";

const RUN_KEY = "recon.lastImportRun.v1";

/** Preset name/key within a company — mirrors the old localStorage composite key. */
function presetName(bankAccountId: string, source: ImportSource, format: ImportFormat) {
  return `${bankAccountId}::${source}::${format}`;
}

/** `kind` column just needs to distinguish bank vs ledger presets per the DB unique constraint. */
function presetKind(format: ImportFormat): "bank_csv" | "ledger_csv" {
  return format === "bank" ? "bank_csv" : "ledger_csv";
}

export async function loadMappingPreset(
  companyId: string,
  bankAccountId: string,
  source: ImportSource,
  format: ImportFormat,
): Promise<{ mapping: Record<string, string>; savedAt: string } | null> {
  if (!companyId || !bankAccountId) return null;
  const { data, error } = await db
    .from("import_mapping_presets")
    .select("mapping, updated_at")
    .eq("company_id", companyId)
    .eq("kind", presetKind(format))
    .eq("name", presetName(bankAccountId, source, format))
    .maybeSingle();
  if (error || !data) return null;
  return { mapping: data.mapping as Record<string, string>, savedAt: data.updated_at as string };
}

export async function saveMappingPreset(
  companyId: string,
  bankAccountId: string,
  source: ImportSource,
  format: ImportFormat,
  mapping: Record<string, string>,
  savedByEmail?: string | null,
) {
  if (!companyId || !bankAccountId) return;
  await db.from("import_mapping_presets").upsert(
    {
      company_id: companyId,
      kind: presetKind(format),
      name: presetName(bankAccountId, source, format),
      mapping,
      created_by_email: savedByEmail ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,kind,name" },
  );
}

export async function clearMappingPreset(
  companyId: string,
  bankAccountId: string,
  source: ImportSource,
  format: ImportFormat,
) {
  if (!companyId || !bankAccountId) return;
  await db
    .from("import_mapping_presets")
    .delete()
    .eq("company_id", companyId)
    .eq("kind", presetKind(format))
    .eq("name", presetName(bankAccountId, source, format));
}

/**
 * Only apply a saved preset when the headers it references still exist,
 * otherwise the mapping silently points at columns that are gone.
 */
export function applicablePreset(
  saved: Record<string, string> | undefined,
  headers: string[],
): Record<string, string> | null {
  if (!saved) return null;
  const used = Object.values(saved).filter(Boolean);
  if (!used.length) return null;
  if (!used.every((h) => headers.includes(h))) return null;
  return saved;
}

/* ---------------------------------------------------------------- steps -- */

export type StepKey = "queued" | "fetching" | "parsing" | "writing" | "done";
export type StepState = "pending" | "active" | "done" | "error";

export const STEP_LABELS: Record<StepKey, string> = {
  queued: "Queued",
  fetching: "Fetching",
  parsing: "Parsing",
  writing: "Writing",
  done: "Done",
};

export const FETCH_STEPS: StepKey[] = ["queued", "fetching", "parsing", "writing", "done"];

/* ------------------------------------------------------------- last run -- */

export type SkippedRow = { index: number; reason: string; preview: string };

export type ImportRun = {
  at: string;
  source: ImportSource;
  format: ImportFormat;
  companyId: string;
  bankAccountId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  label: string;
  step: StepKey;
  status: "running" | "success" | "error";
  error: string | null;
  rowsFetched: number;
  rowsValid: number;
  rowsSkipped: number;
  rowsInserted: number;
  skipped: SkippedRow[];
  log: { at: string; message: string }[];
};

export function loadLastRun(): ImportRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as ImportRun) : null;
  } catch {
    return null;
  }
}

export function saveLastRun(run: ImportRun) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
}

/* --------------------------------------------------------- idempotency -- */

/** Stable key for one logical ingestion of a period from a given source. */
export function buildIdempotencyKey(params: {
  companyId: string;
  bankAccountId: string;
  source: ImportSource;
  format: ImportFormat;
  periodStart: string;
  periodEnd: string;
  /** CSV imports include the file signature so two different files can coexist. */
  fileSignature?: string;
}) {
  const base = [
    params.companyId,
    params.bankAccountId,
    params.source,
    params.format,
    params.periodStart,
    params.periodEnd,
  ];
  if (params.source === "csv" && params.fileSignature) base.push(params.fileSignature);
  return base.join("|");
}

export function isDuplicateKeyError(err: unknown) {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
  const code =
    typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
  return code === "23505" || /duplicate key|already exists/i.test(message);
}

/* ------------------------------------------------------------- csv out -- */

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]) {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

export function downloadCsv(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
