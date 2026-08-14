import { useState } from "react";
import { db } from "@/lib/recon/db";

export type CreateMode = "company" | "account" | null;

export function CreateEntityDialog({
  mode,
  companyId,
  onClose,
  onCreated,
}: {
  mode: CreateMode;
  companyId: string;
  onClose: () => void;
  onCreated: (kind: "company" | "account", id: string) => void;
}) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mode) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      if (mode === "company") {
        if (!name.trim()) throw new Error("Enter a company name.");
        // Company creation + owner membership happen atomically inside this
        // SECURITY DEFINER function — direct inserts into companies/company_members
        // are no longer permitted by RLS (see 20260814010000_saas_hardening.sql).
        const { data: newId, error: cErr } = await db.rpc("create_company_with_owner", {
          _name: name.trim(),
          _currency: currency.trim().toUpperCase() || "NGN",
        });
        if (cErr) throw cErr;
        onCreated("company", newId as string);
      } else {
        if (!companyId) throw new Error("Pick a company first.");
        if (!bankName.trim() || !accountNumber.trim())
          throw new Error("Enter both a bank name and an account number.");
        const { error: aErr } = await db.from("bank_accounts").insert({
          id,
          company_id: companyId,
          bank_name: bankName.trim(),
          account_number: accountNumber.trim(),
        });
        if (aErr) throw aErr;
        const { error: lErr } = await db
          .from("bank_account_companies")
          .insert({ bank_account_id: id, company_id: companyId });
        if (lErr) throw lErr;
        onCreated("account", id);
      }
      setName("");
      setBankName("");
      setAccountNumber("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="panel w-full max-w-md p-5">
        <p className="caption">Create</p>
        <h2 className="text-lg font-semibold">
          {mode === "company" ? "New company" : "New bank account"}
        </h2>

        <div className="mt-4 space-y-3">
          {mode === "company" ? (
            <>
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
                  placeholder="NGN"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="caption">Bank name</label>
                <input
                  className="field mt-1"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Zenith Bank PLC"
                />
              </div>
              <div>
                <label className="caption">Account number</label>
                <input
                  className="field mt-1"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="1012345678"
                />
              </div>
            </>
          )}
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
            {busy ? "Saving…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
