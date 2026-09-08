import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { db, type BankAccount, type Company } from "@/lib/recon/db";
import { useSettings } from "@/lib/recon/settings";
import { ErpIntegrationSection } from "@/components/recon/ErpIntegrationSection";
import { testApiConnection, type TestConnectionResult } from "@/lib/recon/apiTest.functions";
import { useAdminCompanies } from "@/lib/recon/useAdminCompanies";

type LinkRow = { bank_account_id: string; company_id: string };

export type ApiConnection = {
  id: string;
  company_id: string;
  bank_account_id: string;
  enabled: boolean;
  provider_label: string | null;
  endpoint_url: string;
  auth_type: string;
  extra_headers: Record<string, string>;
  last_fetched_at: string | null;
};

const AUTH_TYPES: { key: string; label: string }[] = [
  { key: "bearer", label: "Bearer token" },
  { key: "api_key", label: "API key header (x-api-key)" },
  { key: "basic", label: "Basic auth (key : secret)" },
  { key: "none", label: "No auth" },
];

type Draft = {
  companyId: string;
  enabled: boolean;
  provider_label: string;
  endpoint_url: string;
  auth_type: string;
  api_key: string;
  api_secret: string;
  extra_headers: string;
};

export function ApiIntegrationTab() {
  // Only local/personal fields (confirmDestructive, apiIntegrationEnabled) are used
  // here, so no company scoping is needed.
  const [settings, update] = useSettings("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [connections, setConnections] = useState<ApiConnection[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestConnectionResult & { error?: string }>
  >({});
  const runTest = useServerFn(testApiConnection);
  const { isAdmin } = useAdminCompanies();

  async function testConnection(accountId: string, companyId: string) {
    setTesting(accountId);
    try {
      const result = await runTest({
        data: { companyId, bankAccountId: accountId, kind: "bank" as const },
      });
      setTestResults((r) => ({ ...r, [accountId]: result }));
    } catch (err) {
      setTestResults((r) => ({
        ...r,
        [accountId]: {
          ok: false,
          status: null,
          message: err instanceof Error ? err.message : "Test failed",
          rowCount: 0,
          sampleColumns: [],
          accountCode: null,
          durationMs: 0,
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  async function load() {
    const [cRes, aRes, lRes, connRes] = await Promise.all([
      db.from("companies").select("*").order("name"),
      db.from("bank_accounts").select("*").order("bank_name"),
      db.from("bank_account_companies").select("bank_account_id, company_id"),
      db
        .from("bank_api_connections")
        .select(
          "id, company_id, bank_account_id, enabled, provider_label, endpoint_url, auth_type, extra_headers, last_fetched_at",
        ),
    ]);
    setCompanies((cRes.data ?? []) as Company[]);
    setAccounts((aRes.data ?? []) as BankAccount[]);
    setLinks((lRes.data ?? []) as LinkRow[]);
    setConnections((connRes.data ?? []) as ApiConnection[]);
  }
  useEffect(() => {
    void load();
  }, []);

  const companyName = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const companiesForAccount = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const l of links) (m[l.bank_account_id] ??= []).push(l.company_id);
    return m;
  }, [links]);
  const connByAccount = useMemo(
    () => Object.fromEntries(connections.map((c) => [c.bank_account_id, c])),
    [connections],
  );

  function startEdit(account: BankAccount) {
    const existing = connByAccount[account.id];
    const linked = companiesForAccount[account.id] ?? [];
    setEditing(account.id);
    setError(null);
    setNotice(null);
    setDraft({
      companyId: existing?.company_id ?? account.company_id ?? linked[0] ?? "",
      enabled: existing?.enabled ?? true,
      provider_label: existing?.provider_label ?? "",
      endpoint_url: existing?.endpoint_url ?? "",
      auth_type: existing?.auth_type ?? "bearer",
      api_key: "",
      api_secret: "",
      extra_headers: existing?.extra_headers
        ? JSON.stringify(existing.extra_headers, null, 0)
        : "{}",
    });
  }

  async function save(accountId: string) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!draft.companyId) throw new Error("Pick the company this connection belongs to.");
      if (!draft.endpoint_url.trim()) throw new Error("Enter the bank portal endpoint URL.");
      try {
        const u = new URL(draft.endpoint_url.trim());
        if (u.protocol !== "https:") throw new Error("not https");
      } catch {
        throw new Error(
          "Enter a full public web address for the bank portal, starting with https://",
        );
      }
      let headers: Record<string, string> = {};
      if (draft.extra_headers.trim()) {
        try {
          headers = JSON.parse(draft.extra_headers) as Record<string, string>;
        } catch {
          throw new Error('Extra headers must be valid JSON, e.g. {"X-Bank-Id":"123"}');
        }
      }
      const existing = connByAccount[accountId];
      const base: Record<string, unknown> = {
        company_id: draft.companyId,
        bank_account_id: accountId,
        enabled: draft.enabled,
        provider_label: draft.provider_label.trim() || null,
        endpoint_url: draft.endpoint_url.trim(),
        auth_type: draft.auth_type,
        extra_headers: headers,
      };
      // Credentials are write-only: only send them when the user typed a new value.
      if (draft.api_key.trim()) base.api_key = draft.api_key.trim();
      if (draft.api_secret.trim()) base.api_secret = draft.api_secret.trim();

      if (existing) {
        const { error: err } = await db
          .from("bank_api_connections")
          .update(base)
          .eq("id", existing.id);
        if (err) throw err;
      } else {
        if (!base.api_key && draft.auth_type !== "none")
          throw new Error("Enter the API key/token for this connection.");
        const { error: err } = await db.from("bank_api_connections").insert(base);
        if (err) throw err;
      }
      setEditing(null);
      setDraft(null);
      setNotice("Connection saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(accountId: string) {
    const existing = connByAccount[accountId];
    if (!existing) return;
    if (settings.confirmDestructive && !window.confirm("Remove this bank portal connection?"))
      return;
    setBusy(true);
    const { error: err } = await db.from("bank_api_connections").delete().eq("id", existing.id);
    setBusy(false);
    if (err) setError(err.message);
    else {
      setNotice("Connection removed.");
      await load();
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="caption">Statement source</p>
            <p className="text-sm font-medium">Bank portal API integration</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When off, statements come from CSV upload only and the “Fetch bank statement” action
              is hidden everywhere.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={settings.apiIntegrationEnabled}
              onChange={(e) => update({ apiIntegrationEnabled: e.target.checked })}
            />
            {settings.apiIntegrationEnabled ? "Enabled" : "Disabled"}
          </label>
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          {notice}
        </p>
      )}

      <section className="panel p-4">
        <p className="caption">Per bank account connection details</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Credentials are stored per bank account and are never sent back to the browser — the fetch
          runs server-side.
        </p>

        <div className="mt-3 space-y-2">
          {accounts.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No bank accounts yet — create one in the Bank accounts tab first.
            </p>
          )}
          {accounts.map((a) => {
            const conn = connByAccount[a.id];
            const isEditing = editing === a.id && draft;
            const scopeCompany =
              conn?.company_id ?? a.company_id ?? (companiesForAccount[a.id] ?? [])[0] ?? null;
            const canManage = isAdmin(scopeCompany);
            return (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {a.bank_name} · {a.account_number}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {conn
                        ? `${conn.enabled ? "Connected" : "Paused"} · ${conn.provider_label || "Bank portal"} · ${companyName[conn.company_id] ?? "—"}${
                            conn.last_fetched_at
                              ? ` · last fetch ${new Date(conn.last_fetched_at).toLocaleString()}`
                              : ""
                          }`
                        : "No bank portal connection configured"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!canManage && (
                      <p className="text-[11px] text-muted-foreground">
                        Only company owners and admins can change integration settings.
                      </p>
                    )}
                    {canManage && (
                      <button
                        onClick={() =>
                          isEditing ? (setEditing(null), setDraft(null)) : startEdit(a)
                        }
                        className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
                      >
                        {isEditing ? "Cancel" : conn ? "Edit connection" : "Add connection"}
                      </button>
                    )}
                    {conn && canManage && (
                      <button
                        onClick={() => void testConnection(a.id, conn.company_id)}
                        disabled={testing === a.id}
                        className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary disabled:opacity-50"
                      >
                        {testing === a.id ? "Testing…" : "Test bank connection"}
                      </button>
                    )}
                    {conn && canManage && (
                      <button
                        onClick={() => void remove(a.id)}
                        disabled={busy}
                        className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {testResults[a.id] && (
                  <div
                    className={`mt-2 rounded-md border px-2.5 py-2 text-[11px] ${
                      testResults[a.id].ok
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-destructive/40 bg-destructive/10 text-destructive"
                    }`}
                  >
                    <p className="font-semibold">
                      {testResults[a.id].ok ? "Connection OK" : "Connection failed"}
                      {testResults[a.id].status ? ` · HTTP ${testResults[a.id].status}` : ""}
                      {testResults[a.id].durationMs ? ` · ${testResults[a.id].durationMs}ms` : ""}
                    </p>
                    <p className="mt-0.5">{testResults[a.id].message}</p>
                    {testResults[a.id].sampleColumns.length > 0 && (
                      <p className="mono mt-0.5 opacity-80">
                        Columns: {testResults[a.id].sampleColumns.join(", ")}
                      </p>
                    )}
                  </div>
                )}

                {isEditing && draft && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="caption">Company</label>
                      <select
                        className="field mt-1"
                        value={draft.companyId}
                        onChange={(e) => setDraft({ ...draft, companyId: e.target.value })}
                      >
                        <option value="">— Select company —</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="caption">Provider label</label>
                      <input
                        className="field mt-1"
                        value={draft.provider_label}
                        placeholder="Globus Bank portal"
                        onChange={(e) => setDraft({ ...draft, provider_label: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="caption">Statement endpoint URL</label>
                      <input
                        className="field mt-1"
                        value={draft.endpoint_url}
                        placeholder="https://portal.bank.com/api/v1/accounts/123/statement"
                        onChange={(e) => setDraft({ ...draft, endpoint_url: e.target.value })}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        The selected period is appended as <span className="mono">?from=</span> and{" "}
                        <span className="mono">&to=</span> (YYYY-MM-DD).
                      </p>
                    </div>
                    <div>
                      <label className="caption">Auth type</label>
                      <select
                        className="field mt-1"
                        value={draft.auth_type}
                        onChange={(e) => setDraft({ ...draft, auth_type: e.target.value })}
                      >
                        {AUTH_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="caption">Enabled</label>
                      <div className="mt-2">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="caption">
                        API key / token {conn ? "(leave blank to keep current)" : ""}
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="field mt-1"
                        value={draft.api_key}
                        onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="caption">
                        API secret {conn ? "(leave blank to keep current)" : "(optional)"}
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="field mt-1"
                        value={draft.api_secret}
                        onChange={(e) => setDraft({ ...draft, api_secret: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="caption">Extra headers (JSON)</label>
                      <input
                        className="field mono mt-1"
                        value={draft.extra_headers}
                        onChange={(e) => setDraft({ ...draft, extra_headers: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        onClick={() => void save(a.id)}
                        disabled={busy}
                        className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save connection"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <ErpIntegrationSection />
    </div>
  );
}
