import { parseCsv } from "./csv";
import type { BankAccount, Company } from "./db";

export const BANK_ACCOUNT_CSV_HEADERS = [
  "account_name",
  "account_number",
  "bank_name",
  "currency",
  "opening_balance_statement",
  "opening_balance_ledger",
  "opening_balance_date",
  "company_names",
] as const;

export type BankAccountCsvRow = {
  index: number;
  valid: boolean;
  error: string | null;
  values: {
    account_name: string;
    account_number: string;
    bank_name: string;
    currency: string;
    opening_balance_statement: number;
    opening_balance_ledger: number;
    opening_balance_date: string | null;
    company_names: string[];
  };
};

function csvCell(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bankAccountsTemplateCsv() {
  return BANK_ACCOUNT_CSV_HEADERS.join(",") + "\n";
}

export function bankAccountsToCsv(
  accounts: BankAccount[],
  companyLookup: (bankAccountId: string) => string[],
) {
  const rows = [BANK_ACCOUNT_CSV_HEADERS.join(",")];
  for (const a of accounts) {
    rows.push(
      [
        a.account_name ?? "",
        a.account_number,
        a.bank_name,
        a.currency ?? "NGN",
        a.opening_balance_statement ?? 0,
        a.opening_balance_ledger ?? 0,
        a.opening_balance_date ?? "",
        companyLookup(a.id).join(";"),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\n") + "\n";
}

export function parseBankAccountsCsv(
  text: string,
  companies: Company[],
): { rows: BankAccountCsvRow[]; unknownCompanies: string[] } {
  const parsed = parseCsv(text);
  const headerMap: Record<string, number> = {};
  parsed.headers.forEach((h, i) => {
    headerMap[h.trim().toLowerCase()] = i;
  });

  const companyByName = new Map(
    companies.map((c) => [c.name.trim().toLowerCase(), c] as const),
  );
  const unknown = new Set<string>();

  const rows: BankAccountCsvRow[] = parsed.rows.map((cells, idx) => {
    const g = (key: string) => (cells[headerMap[key]] ?? "").trim();
    const account_name = g("account_name");
    const account_number = g("account_number");
    const bank_name = g("bank_name");
    const currency = g("currency") || "NGN";
    const stmt = Number(g("opening_balance_statement") || "0");
    const led = Number(g("opening_balance_ledger") || "0");
    const asAt = g("opening_balance_date") || null;
    const names = g("company_names")
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    let error: string | null = null;
    if (!account_number) error = "Missing account_number";
    else if (!bank_name) error = "Missing bank_name";
    else if (Number.isNaN(stmt)) error = "Invalid opening_balance_statement";
    else if (Number.isNaN(led)) error = "Invalid opening_balance_ledger";
    else {
      for (const n of names) {
        if (!companyByName.has(n.toLowerCase())) {
          unknown.add(n);
          error = `Unknown company: ${n}`;
          break;
        }
      }
    }

    return {
      index: idx + 2, // header + 1-based
      valid: error === null,
      error,
      values: {
        account_name,
        account_number,
        bank_name,
        currency,
        opening_balance_statement: Number.isNaN(stmt) ? 0 : stmt,
        opening_balance_ledger: Number.isNaN(led) ? 0 : led,
        opening_balance_date: asAt,
        company_names: names,
      },
    };
  });

  return { rows, unknownCompanies: Array.from(unknown) };
}

export function downloadCsv(name: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
