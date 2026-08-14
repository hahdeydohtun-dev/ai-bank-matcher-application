import { parseCsv } from "./csv";

// Fixed CSV templates for open-item uploads. Headers are exact — do not rename
// or reorder without also updating the parser mapping below.

export const OPEN_ITEM_BANK_HEADERS = [
  "Post_Date",
  "Value_Date",
  "Transaction_Reference",
  "Narration",
  "Debit(Amount)",
  "Credit(Amount)",
] as const;

export const OPEN_ITEM_LEDGER_HEADERS = [
  "Posting_Date",
  "Account",
  "Debit(Amount)",
  "Credit(Amount)",
  "Voucher_Type",
  "Voucher_No",
  "Against_Account",
  "Party_Type",
  "Party_Name",
  "Project",
  "Department",
  "Channel",
  "Cost_Center",
  "Against_Voucher_Type",
  "Against_Voucher",
  "Supplier_Invoice_No",
  "Remarks",
] as const;

export function openItemsTemplateCsv(source: "bank" | "ledger") {
  const headers =
    source === "bank" ? OPEN_ITEM_BANK_HEADERS : OPEN_ITEM_LEDGER_HEADERS;
  return headers.join(",") + "\n";
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type OpenItemExport = {
  source: "bank" | "ledger";
  as_at_date: string;
  doc_ref?: string | null;
  amount: number;
  direction: "debit" | "credit";
  party_name?: string | null;
  narration?: string | null;
  meta?: Record<string, unknown> | null;
};

export function openItemsToCsv(
  source: "bank" | "ledger",
  items: OpenItemExport[],
): string {
  const headers =
    source === "bank" ? OPEN_ITEM_BANK_HEADERS : OPEN_ITEM_LEDGER_HEADERS;
  const lines = [headers.join(",")];
  for (const it of items) {
    if (it.source !== source) continue;
    const debit = it.direction === "debit" ? it.amount : "";
    const credit = it.direction === "credit" ? it.amount : "";
    const meta = (it.meta ?? {}) as Record<string, unknown>;
    if (source === "bank") {
      const row = [
        it.as_at_date,
        (meta.value_date as string) ?? "",
        it.doc_ref ?? "",
        it.narration ?? "",
        debit,
        credit,
      ];
      lines.push(row.map(csvEscape).join(","));
    } else {
      const row = [
        it.as_at_date,
        (meta.Account as string) ?? "",
        debit,
        credit,
        (meta.Voucher_Type as string) ?? "",
        it.doc_ref ?? "",
        (meta.Against_Account as string) ?? "",
        (meta.Party_Type as string) ?? "",
        it.party_name ?? "",
        (meta.Project as string) ?? "",
        (meta.Department as string) ?? "",
        (meta.Channel as string) ?? "",
        (meta.Cost_Center as string) ?? "",
        (meta.Against_Voucher_Type as string) ?? "",
        (meta.Against_Voucher as string) ?? "",
        (meta.Supplier_Invoice_No as string) ?? "",
        it.narration ?? "",
      ];
      lines.push(row.map(csvEscape).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

export const OPEN_ITEM_BANK_REQUIRED = [
  "Post_Date",
  "Debit(Amount)",
  "Credit(Amount)",
] as const;

export const OPEN_ITEM_LEDGER_REQUIRED = [
  "Posting_Date",
  "Debit(Amount)",
  "Credit(Amount)",
] as const;

export function missingRequiredHeaders(
  headers: string[],
  source: "bank" | "ledger",
): string[] {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  const required =
    source === "bank" ? OPEN_ITEM_BANK_REQUIRED : OPEN_ITEM_LEDGER_REQUIRED;
  return required.filter((h) => !set.has(h.toLowerCase()));
}

export function parseOpenItemsHeaders(text: string): string[] {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] ?? "";
  // Rough split — enough for header validation; full parser handles quoted data
  return firstLine.split(",").map((s) => s.trim());
}

export type OpenItemParsedValues = {
  as_at_date: string;
  doc_ref: string;
  amount: number;
  direction: "debit" | "credit";
  party_name: string;
  narration: string;
  meta: Record<string, string>;
};

export type OpenItemCsvRow = {
  index: number;
  valid: boolean;
  error: string | null;
  values: OpenItemParsedValues;
};

function toNumber(raw: string): number {
  const cleaned = (raw || "").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeDate(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  // Accept ISO YYYY-MM-DD as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Accept DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function buildHeaderMap(headers: string[]) {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    map[h.trim().toLowerCase()] = i;
  });
  return map;
}

export function parseOpenItemsCsv(
  text: string,
  source: "bank" | "ledger",
  defaultAsAt: string,
): OpenItemCsvRow[] {
  const parsed = parseCsv(text);
  const headerMap = buildHeaderMap(parsed.headers);
  const get = (cells: string[], key: string) =>
    (cells[headerMap[key.toLowerCase()]] ?? "").trim();

  return parsed.rows.map((cells, idx) => {
    if (source === "bank") {
      const post = normalizeDate(get(cells, "Post_Date"));
      const value = normalizeDate(get(cells, "Value_Date"));
      const ref = get(cells, "Transaction_Reference");
      const narration = get(cells, "Narration");
      const debit = toNumber(get(cells, "Debit(Amount)"));
      const credit = toNumber(get(cells, "Credit(Amount)"));
      const asAt = post || value || defaultAsAt;
      const amount = credit || debit;
      const direction: "debit" | "credit" = credit ? "credit" : "debit";

      let error: string | null = null;
      if (!asAt) error = "Missing Post_Date";
      else if (Number.isNaN(debit) || Number.isNaN(credit))
        error = "Invalid Debit/Credit amount";
      else if (!amount) error = "Debit or Credit must be non-zero";

      return {
        index: idx + 2,
        valid: error === null,
        error,
        values: {
          as_at_date: asAt,
          doc_ref: ref,
          amount: Math.abs(amount),
          direction,
          party_name: "",
          narration,
          meta: { value_date: value },
        },
      };
    }

    // ledger
    const posting = normalizeDate(get(cells, "Posting_Date"));
    const debit = toNumber(get(cells, "Debit(Amount)"));
    const credit = toNumber(get(cells, "Credit(Amount)"));
    const voucherNo = get(cells, "Voucher_No");
    const party = get(cells, "Party_Name");
    const remarks = get(cells, "Remarks");
    const asAt = posting || defaultAsAt;
    const amount = debit || credit;
    const direction: "debit" | "credit" = debit ? "debit" : "credit";

    let error: string | null = null;
    if (!asAt) error = "Missing Posting_Date";
    else if (Number.isNaN(debit) || Number.isNaN(credit))
      error = "Invalid Debit/Credit amount";
    else if (!amount) error = "Debit or Credit must be non-zero";

    const meta: Record<string, string> = {};
    for (const h of OPEN_ITEM_LEDGER_HEADERS) {
      if (
        h === "Posting_Date" ||
        h === "Debit(Amount)" ||
        h === "Credit(Amount)" ||
        h === "Voucher_No" ||
        h === "Party_Name" ||
        h === "Remarks"
      )
        continue;
      const v = get(cells, h);
      if (v) meta[h] = v;
    }

    return {
      index: idx + 2,
      valid: error === null,
      error,
      values: {
        as_at_date: asAt,
        doc_ref: voucherNo,
        amount: Math.abs(amount),
        direction,
        party_name: party,
        narration: remarks,
        meta,
      },
    };
  });
}
