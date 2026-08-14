import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Bank Reconciliation for Accounting Teams" },
      {
        name: "description",
        content:
          "Match bank statement lines to ledger records with an AI confidence engine, live team sync and CSV import.",
      },
      { property: "og:title", content: "AI Bank Reconciliation for Accounting Teams" },
      {
        property: "og:description",
        content:
          "Score, review and approve bank-to-ledger matches with AI confidence and live multi-user sync.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/select-company", replace: true });
    });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-2xl">
        <p className="caption">Accounting → Bank Reconciliation Tool</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Reconcile the bank against your ledger, with AI doing the first pass.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Every statement line is scored on amount, reference, date, party and side.
          Auto-matches clear themselves, duplicates and aging items get flagged, and your
          whole team sees accept/reject decisions live.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in to workspace
          </Link>
          <Link
            to="/auth"
            className="panel-2 px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary"
          >
            Create an account
          </Link>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            ["Confidence scoring", "Weighted amount, reference, date, party and side signals."],
            ["Live team sync", "Accepts, rejects and imports stream to every teammate."],
            ["CSV import", "Bank statement and ERP ledger formats, auto-detected."],
          ].map(([title, body]) => (
            <div key={title} className="panel p-4">
              <p className="caption">{title}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
