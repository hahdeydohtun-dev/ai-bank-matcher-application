import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { db, type Company } from "@/lib/recon/db";
import { CreateEntityDialog, type CreateMode } from "@/components/recon/CreateEntityDialog";
import { toast } from "sonner";

const LAST_COMPANY_KEY = "recon.lastCompany";

export const Route = createFileRoute("/_authenticated/select-company")({
  validateSearch: (search: Record<string, unknown>): { force?: "1" } => ({
    force: search.force === "1" || search.force === 1 ? "1" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Select a company · Bank Reconciliation" },
      {
        name: "description",
        content:
          "Pick the company workspace to load bank reconciliation data for.",
      },
      { property: "og:title", content: "Select a company · Bank Reconciliation" },
      {
        property: "og:description",
        content: "Choose which company workspace to open in the reconciliation tool.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SelectCompanyPage,
});

type CompanySummary = {
  accountCount: number;
  lastImport: string | null;
  unreconciled: number;
};

function SelectCompanyPage() {
  const navigate = useNavigate();
  const { force } = Route.useSearch();
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<Record<string, CompanySummary>>({});
  const [q, setQ] = useState("");
  const [createMode, setCreateMode] = useState<CreateMode>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: cs } = await db.from("companies").select("*").order("name");
      const list = (cs ?? []) as Company[];
      if (cancelled) return;
      setCompanies(list);

      // Auto-skip when only one company (unless user asked to switch).
      if (!force && list.length === 1) {
        localStorage.setItem(LAST_COMPANY_KEY, list[0].id);
        navigate({
          to: "/reconciliation",
          search: { company: list[0].id, account: undefined },
          replace: true,
        });
        return;
      }

      // Pull summary badges in parallel.
      const [linksRes, batchRes, txnRes] = await Promise.all([
        db.from("bank_account_companies").select("company_id, bank_account_id"),
        db
          .from("import_batches")
          .select("company_id, created_at")
          .order("created_at", { ascending: false }),
        db
          .from("bank_transactions")
          .select("company_id, status")
          .neq("status", "reconciled"),
      ]);
      if (cancelled) return;
      const next: Record<string, CompanySummary> = {};
      for (const c of list) {
        next[c.id] = { accountCount: 0, lastImport: null, unreconciled: 0 };
      }
      for (const r of (linksRes.data ?? []) as { company_id: string }[]) {
        if (next[r.company_id]) next[r.company_id].accountCount += 1;
      }
      for (const r of (batchRes.data ?? []) as {
        company_id: string;
        created_at: string;
      }[]) {
        const s = next[r.company_id];
        if (s && !s.lastImport) s.lastImport = r.created_at;
      }
      for (const r of (txnRes.data ?? []) as { company_id: string }[]) {
        if (next[r.company_id]) next[r.company_id].unreconciled += 1;
      }
      setSummary(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [force, navigate]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(needle));
  }, [companies, q]);

  const lastPicked = typeof window !== "undefined"
    ? localStorage.getItem(LAST_COMPANY_KEY)
    : null;

  function pick(company: Company) {
    localStorage.setItem(LAST_COMPANY_KEY, company.id);
    navigate({
      to: "/reconciliation",
      search: { company: company.id, account: undefined },
      replace: true,
    });
  }

  const showOnboarding = !loading && companies.length === 0;

  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <p className="caption">Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {showOnboarding ? "Create your first company" : "Select a company"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {showOnboarding
            ? "You aren't a member of any company workspace yet. Create one to start reconciling."
            : "The reconciliation workspace loads data for the company you pick. You can switch anytime from the header."}
        </p>

        {showOnboarding ? (
          <div className="panel mt-8 p-6">
            <p className="text-sm text-muted-foreground">
              A company groups its bank accounts, ledger extracts and open items.
              Once created, you'll add bank accounts and import statements.
            </p>
            <button
              onClick={() => setCreateMode("company")}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              + Create a company
            </button>
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search companies…"
                className="field flex-1 min-w-[240px]"
              />
              <button
                onClick={() => setCreateMode("company")}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
              >
                + New company
              </button>
            </div>

            {loading ? (
              <div className="mt-6 space-y-2">
                <div className="h-16 w-full animate-pulse rounded bg-muted" />
                <div className="h-16 w-full animate-pulse rounded bg-muted" />
                <div className="h-16 w-full animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <ul className="mt-6 space-y-2">
                {filtered.map((c) => {
                  const s = summary[c.id];
                  const isLast = c.id === lastPicked;
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => pick(c)}
                        className="panel-2 w-full p-4 text-left transition-colors hover:border-primary"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">
                              {c.name}
                              {isLast && (
                                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                  Last used
                                </span>
                              )}
                            </p>
                            <p className="mono text-[11px] text-muted-foreground">
                              {c.currency}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            <span>
                              <span className="font-semibold text-foreground">
                                {s?.accountCount ?? 0}
                              </span>{" "}
                              bank {s?.accountCount === 1 ? "account" : "accounts"}
                            </span>
                            <span>
                              <span className="font-semibold text-foreground">
                                {s?.unreconciled ?? 0}
                              </span>{" "}
                              unreconciled
                            </span>
                            <span>
                              Last import:{" "}
                              <span className="font-semibold text-foreground">
                                {s?.lastImport
                                  ? new Date(s.lastImport).toLocaleDateString()
                                  : "—"}
                              </span>
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {!filtered.length && (
                  <li className="panel p-6 text-center text-xs text-muted-foreground">
                    No companies match "{q}".
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>

      <CreateEntityDialog
        mode={createMode}
        companyId=""
        onClose={() => setCreateMode(null)}
        onCreated={(kind, id) => {
          if (kind === "company") {
            toast.success("Company created");
            localStorage.setItem(LAST_COMPANY_KEY, id);
            navigate({
              to: "/reconciliation",
              search: { company: id, account: undefined },
              replace: true,
            });
          }
        }}
      />
    </main>
  );
}
