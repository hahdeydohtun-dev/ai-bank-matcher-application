export type RawTxn = Record<string, unknown>;

export function pick(row: RawTxn, keys: string[]): string | null {
  for (const key of Object.keys(row)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (keys.includes(norm)) {
      const value = row[key];
      if (value === null || value === undefined || value === "") continue;
      return String(value);
    }
  }
  return null;
}

export function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function toDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    // Already an ISO-like yyyy-mm-dd string?
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  }
  return d.toISOString().slice(0, 10);
}

/** Pull the transaction array out of whatever envelope the portal returns. */
export function extractRows(payload: unknown): RawTxn[] {
  if (Array.isArray(payload)) return payload as RawTxn[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["data", "transactions", "items", "results", "records", "entries"]) {
      const value = obj[key];
      if (Array.isArray(value)) return value as RawTxn[];
      if (value && typeof value === "object") {
        const nested = extractRows(value);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}


/** Flatten a raw API row into plain strings so it can cross the RPC boundary. */
export function flattenRow(row: RawTxn): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}
