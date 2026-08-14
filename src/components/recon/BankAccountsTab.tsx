import { useEffect, useMemo, useRef, useState } from "react";
import { db, type BankAccount, type Company } from "@/lib/recon/db";
import {
  BANK_ACCOUNT_CSV_HEADERS,
  bankAccountsTemplateCsv,
  bankAccountsToCsv,
  downloadCsv,
  parseBankAccountsCsv,
  type BankAccountCsvRow,
} from "@/lib/recon/bankAccountCsv";

type LinkRow = { bank_account_id: string; company_id: string };

export function BankAccountsTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [importRows, setImportRows] = useState<BankAccountCsvRow[] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [cRes, aRes, lRes] = await Promise.all([
      db.from("companies").select("*").order("name"),
      db.from("bank_accounts").select("*").order("bank_name"),
      db.from("bank_account_companies").select("bank_account_id, company_id"),
    ]);
    setCompanies((cRes.data ?? []) as Company[]);
    setAccounts((aRes.data ?? []) as BankAccount[]);
    setLinks((lRes.data ?? []) as LinkRow[]);
  }
  useEffect(() => {
    void load();
  }, []);

  const companyName = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const linksByAccount = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const l of links) {
      (m[l.bank_account_id] ??= []).push(l.company_id);
    }
    return m;
  }, [links]);

  async function exportCsv() {
    const csv = bankAccountsToCsv(accounts, (id) =>
      (linksByAccount[id] ?? []).map((cid) => companyName[cid] ?? "").filter(Boolean),
    );
    downloadCsv("bank-accounts.csv", csv);
  }

  async function handleImportFile(file: File) {
    setError(null);
    setNotice(null);
    setImportFileName(file.name);
    const text = await file.text();
    const { rows, unknownCompanies } = parseBankAccountsCsv(text, companies);
    setImportRows(rows);
    if (unknownCompanies.length) {
      setError(
        `Unknown companies referenced: ${unknownCompanies.join(", ")}. Create them first, then re-upload.`,
      );
    }
  }

  async function confirmImport() {
    if (!importRows) return;
    const valid = importRows.filter((r) => r.valid);
    if (!valid.length) {
      setError("No valid rows to import.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const row of valid) {
        const v = row.values;
        // upsert by (bank_name, account_number)
        const { data: existing } = await db
          .from("bank_accounts")
          .select("id")
          .eq("bank_name", v.bank_name)
          .eq("account_number", v.account_number)
          .maybeSingle();

        const payload = {
          bank_name: v.bank_name,
          account_number: v.account_number,
          account_name: v.account_name || null,
          currency: v.currency,
          opening_balance_statement: v.opening_balance_statement,
          opening_balance_ledger: v.opening_balance_ledger,
          opening_balance_date: v.opening_balance_date,
        };

        let accountId: string;
        if (existing?.id) {
          const { error: uErr } = await db
            .from("bank_accounts")
            .update(payload)
            .eq("id", existing.id);
          if (uErr) throw uErr;
          accountId = existing.id;
        } else {
          const id = crypto.randomUUID();
          const { error: iErr } = await db
            .from("bank_accounts")
            .insert({ id, ...payload });
          if (iErr) throw iErr;
          accountId = id;
        }

        const desiredCompanyIds = v.company_names
          .map((n) => companies.find((c) => c.name.trim().toLowerCase() === n.toLowerCase())?.id)
          .filter(Boolean) as string[];
        if (desiredCompanyIds.length) {
          await db
            .from("bank_account_companies")
            .upsert(
              desiredCompanyIds.map((cid) => ({
                bank_account_id: accountId,
                company_id: cid,
              })),
              { onConflict: "bank_account_id,company_id" },
            );
        }
      }
      setNotice(`Imported ${valid.length} bank account row(s).`);
      setImportRows(null);
      setImportFileName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Bank accounts</h2>
          <p className="text-xs text-muted-foreground">
            Each account can be linked to one or more companies.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadCsv("bank-accounts-template.csv", bankAccountsTemplateCsv())}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
          >
            Download template
          </button>
          <button
            onClick={exportCsv}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
          >
            Download CSV
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs hover:border-primary"
          >
            Upload CSV
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            + Add bank account
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          {notice}
        </p>
      )}

      {importRows && (
        <div className="panel p-3">
          <div className="flex items-center justify-between">
            <p className="caption">
              Preview · {importFileName} · {importRows.filter((r) => r.valid).length}/
              {importRows.length} valid
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setImportRows(null)}
                className="rounded-md border border-border-strong px-2 py-1 text-[11px]"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={busy || !importRows.some((r) => r.valid)}
                className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Importing…" : "Confirm import"}
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-64 overflow-auto rounded border border-border text-[11px]">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  <th className="caption px-2 py-1 text-left">Row</th>
                  <th className="caption px-2 py-1 text-left">Status</th>
                  {BANK_ACCOUNT_CSV_HEADERS.map((h) => (
                    <th key={h} className="caption px-2 py-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importRows.map((r) => (
                  <tr key={r.index} className="border-t border-border">
                    <td className="mono px-2 py-1">{r.index}</td>
                    <td className="px-2 py-1">
                      <span
                        title={r.error ?? "Valid"}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.valid
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-destructive/40 bg-destructive/10 text-destructive"
                        }`}
                      >
                        {r.valid ? "OK" : "Error"}
                      </span>
                    </td>
                    <td className="mono px-2 py-1">{r.values.account_name}</td>
                    <td className="mono px-2 py-1">{r.values.account_number}</td>
                    <td className="mono px-2 py-1">{r.values.bank_name}</td>
                    <td className="mono px-2 py-1">{r.values.currency}</td>
                    <td className="mono px-2 py-1">{r.values.opening_balance_statement}</td>
                    <td className="mono px-2 py-1">{r.values.opening_balance_ledger}</td>
                    <td className="mono px-2 py-1">{r.values.opening_balance_date ?? ""}</td>
                    <td className="mono px-2 py-1">{r.values.company_names.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel p-3">
        {!accounts.length ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No bank accounts yet. Add one to get started.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="caption px-2 py-1.5">Account</th>
                  <th className="caption px-2 py-1.5">Bank</th>
                  <th className="caption px-2 py-1.5">Number</th>
                  <th className="caption px-2 py-1.5">Currency</th>
                  <th className="caption px-2 py-1.5">Opening (stmt)</th>
                  <th className="caption px-2 py-1.5">Opening (ledger)</th>
                  <th className="caption px-2 py-1.5">As at</th>
                  <th className="caption px-2 py-1.5">Companies</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    companies={companies}
                    linkedCompanyIds={linksByAccount[a.id] ?? []}
                    onChanged={() => void load()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddBankAccountDialog
          companies={companies}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AccountRow({
  account,
  companies,
  linkedCompanyIds,
  onChanged,
}: {
  account: BankAccount;
  companies: Company[];
  linkedCompanyIds: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [form, setForm] = useState({
    account_name: account.account_name ?? "",
    account_number: account.account_number ?? "",
    bank_name: account.bank_name ?? "",
    currency: account.currency ?? "NGN",
    opening_balance_statement: String(account.opening_balance_statement ?? 0),
    opening_balance_ledger: String(account.opening_balance_ledger ?? 0),
    opening_balance_date: account.opening_balance_date ?? "",
  });
  const [selected, setSelected] = useState<string[]>(linkedCompanyIds);

  useEffect(() => {
    setSelected(linkedCompanyIds);
    setForm({
      account_name: account.account_name ?? "",
      account_number: account.account_number ?? "",
      bank_name: account.bank_name ?? "",
      currency: account.currency ?? "NGN",
      opening_balance_statement: String(account.opening_balance_statement ?? 0),
      opening_balance_ledger: String(account.opening_balance_ledger ?? 0),
      opening_balance_date: account.opening_balance_date ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, linkedCompanyIds.join(",")]);

  function toggleCompany(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    if (!form.bank_name.trim() || !form.account_number.trim()) {
      setRowError("Bank name and account number are required.");
      return;
    }
    if (!selected.length) {
      setRowError("Select at least one company.");
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      const { error: uErr } = await db
        .from("bank_accounts")
        .update({
          account_name: form.account_name.trim() || null,
          account_number: form.account_number.trim(),
          bank_name: form.bank_name.trim(),
          currency: form.currency.trim().toUpperCase() || "NGN",
          opening_balance_statement: Number(form.opening_balance_statement) || 0,
          opening_balance_ledger: Number(form.opening_balance_ledger) || 0,
          opening_balance_date: form.opening_balance_date || null,
        })
        .eq("id", account.id);
      if (uErr) throw uErr;

      const toAdd = selected.filter((id) => !linkedCompanyIds.includes(id));
      const toRemove = linkedCompanyIds.filter((id) => !selected.includes(id));
      if (toAdd.length) {
        const { error } = await db
          .from("bank_account_companies")
          .insert(toAdd.map((cid) => ({ bank_account_id: account.id, company_id: cid })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await db
          .from("bank_account_companies")
          .delete()
          .eq("bank_account_id", account.id)
          .in("company_id", toRemove);
        if (error) throw error;
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete bank account "${account.bank_name} · ${account.account_number}"? This cannot be undone. Linked transactions, data sets, and open items must be removed first.`,
      )
    )
      return;
    setBusy(true);
    setRowError(null);
    try {
      await db
        .from("bank_account_companies")
        .delete()
        .eq("bank_account_id", account.id);
      const { error } = await db.from("bank_accounts").delete().eq("id", account.id);
      if (error) throw error;
      onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      setRowError(
        msg.includes("foreign key")
          ? "Cannot delete: this bank account still has linked transactions, data sets, or open items."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setSelected(linkedCompanyIds);
    setForm({
      account_name: account.account_name ?? "",
      account_number: account.account_number ?? "",
      bank_name: account.bank_name ?? "",
      currency: account.currency ?? "NGN",
      opening_balance_statement: String(account.opening_balance_statement ?? 0),
      opening_balance_ledger: String(account.opening_balance_ledger ?? 0),
      opening_balance_date: account.opening_balance_date ?? "",
    });
    setRowError(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <>
        <tr className="border-b border-border/50 align-top bg-surface-2/40">
          <td className="px-2 py-1.5">
            <input
              className="field h-8 w-40"
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
              placeholder="Account name"
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="field h-8 w-32"
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="field mono h-8 w-32"
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value })}
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="field mono h-8 w-16"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="field mono h-8 w-24"
              value={form.opening_balance_statement}
              onChange={(e) =>
                setForm({ ...form, opening_balance_statement: e.target.value })
              }
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              className="field mono h-8 w-24"
              value={form.opening_balance_ledger}
              onChange={(e) =>
                setForm({ ...form, opening_balance_ledger: e.target.value })
              }
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              type="date"
              className="field mono h-8 w-36"
              value={form.opening_balance_date}
              onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value })}
            />
          </td>
          <td className="px-2 py-1.5">
            <div className="flex max-h-24 w-56 flex-wrap gap-1 overflow-auto rounded border border-border p-1">
              {companies.length ? (
                companies.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                      selected.includes(c.id)
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={selected.includes(c.id)}
                      onChange={() => toggleCompany(c.id)}
                    />
                    {c.name}
                  </label>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground">No companies</span>
              )}
            </div>
          </td>
          <td className="px-2 py-1.5 text-right">
            <div className="flex justify-end gap-1">
              <button
                onClick={() => void save()}
                disabled={busy}
                className="rounded border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                onClick={cancel}
                disabled={busy}
                className="rounded border border-border-strong px-2 py-0.5 text-[10px]"
              >
                Cancel
              </button>
              <button
                onClick={() => void remove()}
                disabled={busy}
                className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
        {rowError && (
          <tr>
            <td colSpan={9} className="px-2 pb-2">
              <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                {rowError}
              </p>
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <tr className="border-b border-border align-top">
      <td className="px-2 py-1.5">{account.account_name || "—"}</td>
      <td className="px-2 py-1.5">{account.bank_name}</td>
      <td className="mono px-2 py-1.5">{account.account_number}</td>
      <td className="mono px-2 py-1.5">{account.currency ?? "NGN"}</td>
      <td className="mono px-2 py-1.5">{account.opening_balance_statement ?? 0}</td>
      <td className="mono px-2 py-1.5">{account.opening_balance_ledger ?? 0}</td>
      <td className="mono px-2 py-1.5">{account.opening_balance_date ?? "—"}</td>
      <td className="px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          {linkedCompanyIds.length
            ? linkedCompanyIds
                .map((cid) => companies.find((c) => c.id === cid)?.name ?? "?")
                .join(", ")
            : "—"}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          onClick={() => setEditing(true)}
          className="rounded border border-border-strong px-2 py-0.5 text-[10px] hover:border-primary"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}


function AddBankAccountDialog({
  companies,
  onClose,
  onCreated,
}: {
  companies: Company[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    account_name: "",
    account_number: "",
    bank_name: "",
    currency: "NGN",
    opening_balance_statement: "0",
    opening_balance_ledger: "0",
    opening_balance_date: "",
  });
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!form.account_number.trim() || !form.bank_name.trim())
        throw new Error("Bank name and account number are required.");
      if (!companyIds.length)
        throw new Error("Select at least one company for this bank account.");

      const id = crypto.randomUUID();
      const { error: aErr } = await db.from("bank_accounts").insert({
        id,
        account_name: form.account_name.trim() || null,
        account_number: form.account_number.trim(),
        bank_name: form.bank_name.trim(),
        currency: form.currency.trim().toUpperCase() || "NGN",
        opening_balance_statement: Number(form.opening_balance_statement) || 0,
        opening_balance_ledger: Number(form.opening_balance_ledger) || 0,
        opening_balance_date: form.opening_balance_date || null,
        company_id: companyIds[0], // legacy back-compat
      });
      if (aErr) throw aErr;
      const { error: lErr } = await db
        .from("bank_account_companies")
        .insert(companyIds.map((cid) => ({ bank_account_id: id, company_id: cid })));
      if (lErr) throw lErr;
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create bank account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <div className="panel my-6 w-full max-w-lg p-5">
        <p className="caption">Create</p>
        <h2 className="text-lg font-semibold">New bank account</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="caption">Account name</label>
            <input
              className="field mt-1"
              value={form.account_name}
              onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
              placeholder="Operating account"
            />
          </div>
          <div>
            <label className="caption">Bank name *</label>
            <input
              className="field mt-1"
              value={form.bank_name}
              onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="caption">Account number *</label>
            <input
              className="field mt-1"
              value={form.account_number}
              onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
            />
          </div>
          <div>
            <label className="caption">Currency</label>
            <input
              className="field mt-1"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            />
          </div>
          <div>
            <label className="caption">Opening balance date</label>
            <input
              type="date"
              className="field mt-1"
              value={form.opening_balance_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, opening_balance_date: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="caption">Opening balance (statement)</label>
            <input
              type="number"
              className="field mt-1"
              value={form.opening_balance_statement}
              onChange={(e) =>
                setForm((f) => ({ ...f, opening_balance_statement: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="caption">Opening balance (ledger)</label>
            <input
              type="number"
              className="field mt-1"
              value={form.opening_balance_ledger}
              onChange={(e) =>
                setForm((f) => ({ ...f, opening_balance_ledger: e.target.value }))
              }
            />
          </div>
          <div className="sm:col-span-2">
            <label className="caption">Companies (hold Ctrl / Cmd to pick multiple) *</label>
            <select
              multiple
              className="field mt-1 h-32"
              value={companyIds}
              onChange={(e) =>
                setCompanyIds(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create bank account"}
          </button>
        </div>
      </div>
    </div>
  );
}
