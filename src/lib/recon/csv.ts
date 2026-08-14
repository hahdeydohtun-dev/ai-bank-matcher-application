export type CsvTable = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (cleaned.shift() ?? []).map((h) => h.trim());
  return { headers, rows: cleaned };
}

export function normalizeHeader(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export const BANK_HEADERS = [
  "S/N",
  "Post_Date",
  "Value_Date",
  "Transaction_Reference",
  "Narration",
  "Debit(Amount)",
  "Credit(Amount)",
  "Balance(Amount)",
];

export const LEDGER_HEADERS = [
  "Posting_Date",
  "Account",
  "Debit(Amount)",
  "Credit(Amount)",
  "Balance(Amount)",
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
];

export type Format = "bank" | "ledger";

export type FieldDef = { key: string; label: string; aliases: string[]; required?: boolean };

export const BANK_FIELDS: FieldDef[] = [
  { key: "txn_date", label: "Post date", aliases: ["POSTDATE", "TRANSACTIONDATE", "DATE", "TXNDATE"], required: true },
  { key: "value_date", label: "Value date", aliases: ["VALUEDATE"] },
  { key: "txn_ref", label: "Reference", aliases: ["TRANSACTIONREFERENCE", "REFERENCE", "REF", "TXNREF"], required: true },
  { key: "narration", label: "Narration", aliases: ["NARRATION", "DESCRIPTION", "DETAILS", "REMARKS"] },
  { key: "debit", label: "Debit amount", aliases: ["DEBITAMOUNT", "DEBIT", "WITHDRAWAL"], required: true },
  { key: "credit", label: "Credit amount", aliases: ["CREDITAMOUNT", "CREDIT", "DEPOSIT", "LODGEMENT"], required: true },
  { key: "balance", label: "Balance", aliases: ["BALANCEAMOUNT", "BALANCE", "RUNNINGBALANCE"] },
];

export const LEDGER_FIELDS: FieldDef[] = [
  { key: "doc_date", label: "Posting date", aliases: ["POSTINGDATE", "DATE", "DOCDATE"], required: true },
  { key: "doc_type", label: "Voucher type", aliases: ["VOUCHERTYPE", "DOCTYPE"] },
  { key: "doc_number", label: "Voucher no", aliases: ["VOUCHERNO", "DOCNUMBER", "VOUCHERNUMBER", "SUPPLIERINVOICENO"], required: true },
  { key: "party_name", label: "Party name", aliases: ["PARTYNAME", "PARTY", "ACCOUNT"] },
  { key: "party_type", label: "Party type", aliases: ["PARTYTYPE"] },
  { key: "debit", label: "Debit amount", aliases: ["DEBITAMOUNT", "DEBIT"], required: true },
  { key: "credit", label: "Credit amount", aliases: ["CREDITAMOUNT", "CREDIT"], required: true },
  { key: "balance", label: "Balance", aliases: ["BALANCEAMOUNT", "BALANCE"] },
];

export function detectFormat(headers: string[]): Format {
  const set = new Set(headers.map(normalizeHeader));
  const bankHits = BANK_HEADERS.filter((h) => set.has(normalizeHeader(h))).length;
  const ledgerHits = LEDGER_HEADERS.filter((h) => set.has(normalizeHeader(h))).length;
  return ledgerHits > bankHits ? "ledger" : "bank";
}

export function guessMapping(headers: string[], fields: FieldDef[]) {
  const mapping: Record<string, string> = {};
  const normalized = headers.map(normalizeHeader);
  for (const field of fields) {
    const idx = normalized.findIndex((h) =>
      field.aliases.some((a) => h === a || h.includes(a)),
    );
    mapping[field.key] = idx >= 0 ? headers[idx] : "";
  }
  return mapping;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function iso(y: number, m: number, d: number) {
  if (!y || !m || !d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseFlexibleDate(input: string): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;

  let m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = value.match(/^(\d{1,2})[/](\d{1,2})[/](\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return a > 12 || b <= 12 ? iso(+m[3], b, a) : iso(+m[3], a, b);
  }

  m = value.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (month) return iso(+m[3], month, +m[1]);
  }

  m = value.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toUpperCase()];
    if (month) return iso(+m[3], month, +m[2]);
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

export function parseNumber(input: string): number {
  const cleaned = (input ?? "").replace(/[^0-9.\-()]/g, "").trim();
  if (!cleaned) return 0;
  const negative = /^\(.*\)$/.test(cleaned);
  const n = Number(cleaned.replace(/[()]/g, ""));
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

export type ParsedRow = {
  index: number;
  valid: boolean;
  reason?: string;
  values: Record<string, string>;
  amount: number;
  direction: "debit" | "credit";
  date: string | null;
  valueDate?: string | null;
  meta: Record<string, string>;
};

export function buildRows(
  table: CsvTable,
  fields: FieldDef[],
  mapping: Record<string, string>,
): ParsedRow[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return table.rows.map((cells, index) => {
    const record: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      record[h] = (cells[i] ?? "").trim();
    });

    const pick = (key: string) => record[mapping[key]] ?? "";
    const debit = parseNumber(pick("debit"));
    const credit = parseNumber(pick("credit"));
    const dateKey = fields.some((f) => f.key === "txn_date") ? "txn_date" : "doc_date";
    const date = parseFlexibleDate(pick(dateKey));

    const meta: Record<string, string> = {};
    for (const header of table.headers) {
      if (!mapped.has(header) && record[header]) meta[header] = record[header];
    }

    let reason: string | undefined;
    if (debit !== 0 && credit !== 0) reason = "Both debit and credit are populated";
    else if (debit === 0 && credit === 0) reason = "Neither debit nor credit is populated";
    else if (!date) reason = "Date could not be parsed";

    for (const field of fields) {
      if (field.required && field.key !== "debit" && field.key !== "credit") {
        if (!pick(field.key)) reason ??= `Missing ${field.label.toLowerCase()}`;
      }
    }

    return {
      index,
      valid: !reason,
      reason,
      values: {
        ...Object.fromEntries(fields.map((f) => [f.key, pick(f.key)])),
      },
      amount: Math.abs(debit !== 0 ? debit : credit),
      direction: debit !== 0 ? "debit" : "credit",
      date,
      valueDate: parseFlexibleDate(pick("value_date")) ?? date,
      meta,
    };
  });
}

export function templateCsv(format: Format) {
  if (format === "bank") {
    return [
      BANK_HEADERS.join(","),
      "1,2025-06-02,2025-06-02,ZEN/2025/000201,NIP INWARD DANGOTE CEMENT PLC SINV-2025-0041,0,4250000.00,14250000.00",
      "2,03/06/2025,03/06/2025,ZEN/2025/000202,OUTWARD TRANSFER SAHARA ENERGY LTD PINV-2025-0113,920000.00,0,13330000.00",
    ].join("\n");
  }
  return [
    LEDGER_HEADERS.join(","),
    "2025-06-02,Bank - Zenith,4250000.00,0,4250000.00,Sales Invoice,SINV-2025-0061,Debtors,Customer,Dangote Cement PLC,Lagos Depot,Sales,Bank Transfer,CC-01,Sales Order,SO-0012,,Opening settlement",
    "04-Jun-2025,Bank - Zenith,0,920000.00,3330000.00,Purchase Invoice,PINV-2025-0130,Creditors,Supplier,Sahara Energy Ltd,Apapa,Operations,Bank Transfer,CC-02,Purchase Order,PO-0031,SINV-9931,Fuel supply",
  ].join("\n");
}
