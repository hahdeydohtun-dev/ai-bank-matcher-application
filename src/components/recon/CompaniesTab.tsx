import { useEffect, useState } from "react";
import { db, type Company } from "@/lib/recon/db";

export function CompaniesTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await db.from("companies").select("*").order("name");
    setCompanies((data ?? []) as Company[]);
  }
  useEffect(() => {
    void load();
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error("Enter a company name.");
      // Company creation + owner membership happen atomically inside this
      // SECURITY DEFINER function — direct inserts into companies/company_members
      // are no longer permitted by RLS (see 20260814010000_saas_hardening.sql).
      const { error: cErr } = await db.rpc("create_company_with_owner", {
        _name: name.trim(),
        _currency: currency.trim().toUpperCase() || "NGN",
      });
      if (cErr) throw cErr;
      setName("");
      setCurrency("NGN");
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create company");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Companies</h2>
          <p className="text-xs text-muted-foreground">
            New companies are immediately available in every selector app-wide.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          + Add company
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="panel p-3">
        {companies.length ? (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="caption px-2 py-1.5">Name</th>
                <th className="caption px-2 py-1.5">Currency</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  onChanged={() => void load()}
                  onError={(m) => setError(m)}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">No companies yet.</p>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-md p-5">
            <p className="caption">Create</p>
            <h2 className="text-lg font-semibold">New company</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="caption">Company name</label>
                <input
                  className="field mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="XYZ Trading Ltd"
                />
              </div>
              <div>
                <label className="caption">Currency</label>
                <input
                  className="field mt-1"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyRow({
  company,
  onChanged,
  onError,
}: {
  company: Company;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [currency, setCurrency] = useState(company.currency ?? "NGN");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(company.name);
    setCurrency(company.currency ?? "NGN");
  }, [company.id, company.name, company.currency]);

  async function save() {
    if (!name.trim()) {
      onError("Company name cannot be empty.");
      return;
    }
    setBusy(true);
    onError(null);
    const { error } = await db
      .from("companies")
      .update({
        name: name.trim(),
        currency: currency.trim().toUpperCase() || "NGN",
      })
      .eq("id", company.id);
    setBusy(false);
    if (error) {
      onError(error.message);
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete "${company.name}"? This cannot be undone. Linked bank accounts and data sets must be reassigned or removed first.`,
      )
    )
      return;
    setBusy(true);
    onError(null);
    const { error } = await db.from("companies").delete().eq("id", company.id);
    setBusy(false);
    if (error) {
      onError(
        error.message.includes("foreign key")
          ? "Cannot delete: this company still has linked bank accounts, data sets, or transactions."
          : error.message,
      );
      return;
    }
    onChanged();
  }

  return (
    <tr className="border-b border-border align-top">
      <td className="px-2 py-1.5">
        {editing ? (
          <input
            className="field h-8 w-56"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          company.name
        )}
      </td>
      <td className="mono px-2 py-1.5">
        {editing ? (
          <input
            className="field h-8 w-20"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        ) : (
          company.currency
        )}
      </td>
      <td className="px-2 py-1.5 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setName(company.name);
                setCurrency(company.currency ?? "NGN");
                setEditing(false);
                onError(null);
              }}
              className="rounded border border-border-strong px-2 py-0.5 text-[10px]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-border-strong px-2 py-0.5 text-[10px] hover:border-primary"
            >
              Edit
            </button>
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
