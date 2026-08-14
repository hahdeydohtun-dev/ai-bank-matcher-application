import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, useSettings, type ThemeKey } from "@/lib/recon/settings";
import { CompaniesTab } from "@/components/recon/CompaniesTab";
import { BankAccountsTab } from "@/components/recon/BankAccountsTab";
import { OpeningBalancesTab } from "@/components/recon/OpeningBalancesTab";
import { ApiIntegrationTab } from "@/components/recon/ApiIntegrationTab";
import { TeamTab } from "@/components/recon/TeamTab";
import { db, type Company } from "@/lib/recon/db";

const LAST_COMPANY_KEY = "recon.lastCompany";

export const Route = createFileRoute("/_authenticated/control-panel")({
  head: () => ({
    meta: [
      { title: "Control Panel · Bank Reconciliation" },
      {
        name: "description",
        content:
          "Manage companies, bank accounts, opening balances, open items and workspace settings for the reconciliation tool.",
      },
      { property: "og:title", content: "Reconciliation Control Panel" },
      {
        property: "og:description",
        content:
          "Companies, bank accounts, opening balances, open items and AI matching settings in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ControlPanelPage,
});

const THEMES: { key: ThemeKey; label: string; hint: string }[] = [
  { key: "navy", label: "ERP Navy", hint: "Default dark navy" },
  { key: "midnight", label: "Midnight Teal", hint: "Deep neutral, teal accent" },
  { key: "slate", label: "Slate Amber", hint: "Warm amber accent" },
  { key: "light", label: "Daylight", hint: "Light workspace" },
];

type Tab = "companies" | "accounts" | "opening" | "team" | "api" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "companies", label: "Companies" },
  { key: "accounts", label: "Bank accounts" },
  { key: "opening", label: "Opening balances & open items" },
  { key: "team", label: "Team" },
  { key: "api", label: "API integration" },
  { key: "settings", label: "Workspace settings" },
];

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ControlPanelPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [settings, update, reset] = useSettings(companyId);
  const [tab, setTab] = useState<Tab>("companies");

  // The AI matching engine / bank charges / thresholds settings below are
  // shared per-company (see company_settings), so the settings tab needs an
  // active company selected before it can load or persist anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await db.from("companies").select("*").order("name");
      const list = (data ?? []) as Company[];
      if (cancelled) return;
      setCompanies(list);
      setCompanyId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        const lastPicked =
          typeof window !== "undefined" ? localStorage.getItem(LAST_COMPANY_KEY) : null;
        const fallback = list.find((c) => c.id === lastPicked) ?? list[0];
        return fallback?.id ?? "";
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  function selectCompany(id: string) {
    setCompanyId(id);
    if (id && typeof window !== "undefined") localStorage.setItem(LAST_COMPANY_KEY, id);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="caption">Accounting → Control Panel</p>
          <div className="flex items-center gap-2">
            {companies.length > 0 && (
              <select
                className="field h-8 w-48 text-xs"
                value={companyId}
                onChange={(e) => selectCompany(e.target.value)}
                title="AI matching / bank-charge settings apply to this company only"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <Link
              to="/reconciliation"
              className="rounded-md border border-border-strong px-2.5 py-1 text-[11px] font-semibold hover:border-primary"
            >
              Back to reconciliation
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Control Panel</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage the connected data model — Company → Bank Account → Data Set — plus workspace
            preferences.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "companies" && <CompaniesTab />}
        {tab === "accounts" && <BankAccountsTab />}
        {tab === "opening" && <OpeningBalancesTab />}
        {tab === "team" && <TeamTab companyId={companyId} />}
        {tab === "api" && <ApiIntegrationTab />}

        {tab === "settings" && !companyId && (
          <div className="panel p-6 text-center text-xs text-muted-foreground">
            Create a company first — matching thresholds and bank-charge rules are shared
            per-company.
          </div>
        )}

        {tab === "settings" && companyId && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Auto-match threshold, review threshold, high-value flag, aging days and bank-charge
              rules below are shared with your whole{" "}
              <span className="font-semibold text-foreground">
                {companies.find((c) => c.id === companyId)?.name}
              </span>{" "}
              team. Appearance and workspace preferences stay local to you.
            </p>
            <section className="panel p-4">
              <p className="caption">Appearance</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => update({ theme: t.key })}
                    className={`panel-2 p-3 text-left transition-colors hover:border-primary ${
                      settings.theme === t.key ? "border-primary ring-1 ring-primary/40" : ""
                    }`}
                  >
                    <p className="text-xs font-semibold">{t.label}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{t.hint}</p>
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <Row label="Density" hint="Compact shrinks the base text size across the app.">
                  <select
                    className="field w-40"
                    value={settings.density}
                    onChange={(e) =>
                      update({ density: e.target.value as "comfortable" | "compact" })
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </Row>
              </div>
            </section>

            <section className="panel p-4">
              <p className="caption">AI matching engine</p>
              <Row label="Auto-match threshold" hint="Confidence at or above this is auto-matched.">
                <input
                  type="number"
                  min={50}
                  max={100}
                  className="field w-28"
                  value={settings.autoThreshold}
                  onChange={(e) => update({ autoThreshold: Number(e.target.value) })}
                />
              </Row>
              <Row label="Review threshold" hint="Below this a transaction counts as unmatched.">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="field w-28"
                  value={settings.reviewThreshold}
                  onChange={(e) => update({ reviewThreshold: Number(e.target.value) })}
                />
              </Row>
              <Row label="High-value flag" hint="Amounts above this are flagged for extra review.">
                <input
                  type="number"
                  className="field w-40"
                  value={settings.highValueThreshold}
                  onChange={(e) => update({ highValueThreshold: Number(e.target.value) })}
                />
              </Row>
              <Row label="Aging days" hint="Unmatched items older than this are flagged as aging.">
                <input
                  type="number"
                  className="field w-28"
                  value={settings.agingDays}
                  onChange={(e) => update({ agingDays: Number(e.target.value) })}
                />
              </Row>
            </section>

            <section className="panel p-4">
              <p className="caption">Bank charges</p>
              <Row
                label="Auto-suggest bank charges"
                hint="Pairs charge lines on the statement with charge entries in the ERP ledger."
              >
                <input
                  type="checkbox"
                  checked={settings.bankChargeAutoMatch}
                  onChange={(e) => update({ bankChargeAutoMatch: e.target.checked })}
                />
              </Row>
              <Row label="Amount tolerance (%)" hint="How far the two amounts may differ.">
                <input
                  type="number"
                  step="0.5"
                  className="field w-28"
                  value={settings.chargeTolerance}
                  onChange={(e) => update({ chargeTolerance: Number(e.target.value) })}
                />
              </Row>
              <div className="py-3">
                <p className="text-sm font-medium">Charge keywords</p>
                <p className="text-xs text-muted-foreground">
                  Comma separated. Used on both the bank narration and the ledger description.
                </p>
                <textarea
                  className="field mt-2 h-24"
                  value={settings.bankChargeKeywords.join(", ")}
                  onChange={(e) =>
                    update({
                      bankChargeKeywords: e.target.value
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </section>

            <section className="panel p-4">
              <p className="caption">Workspace</p>
              <Row label="Default view" hint="Which workspace tab opens first.">
                <select
                  className="field w-44"
                  value={settings.defaultView}
                  onChange={(e) => update({ defaultView: e.target.value as "list" | "board" })}
                >
                  <option value="list">Transaction list</option>
                  <option value="board">Side-by-side match board</option>
                </select>
              </Row>
              <Row label="Live multi-user sync" hint="Realtime updates from teammates.">
                <input
                  type="checkbox"
                  checked={settings.liveSync}
                  onChange={(e) => update({ liveSync: e.target.checked })}
                />
              </Row>
              <Row label="Show AI panel by default">
                <input
                  type="checkbox"
                  checked={settings.showAiPanel}
                  onChange={(e) => update({ showAiPanel: e.target.checked })}
                />
              </Row>
              <Row
                label="Confirm destructive actions"
                hint="Ask before clearing data sets or resetting the workspace."
              >
                <input
                  type="checkbox"
                  checked={settings.confirmDestructive}
                  onChange={(e) => update({ confirmDestructive: e.target.checked })}
                />
              </Row>
            </section>

            <div className="flex justify-end">
              <button
                onClick={reset}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-destructive hover:text-destructive"
              >
                Restore defaults ({DEFAULT_SETTINGS.theme} theme, {DEFAULT_SETTINGS.autoThreshold}%
                auto)
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
