import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { db, supabase } from "@/lib/recon/db";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Accept invite · Bank Reconciliation" },
      {
        name: "description",
        content: "Join a company workspace in the AI bank reconciliation tool.",
      },
    ],
  }),
  component: AcceptInvitePage,
});

type Status = "checking" | "signed-out" | "accepting" | "accepted" | "error";

function AcceptInvitePage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This invite link is missing its token.");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!sessionData.session) {
        setStatus("signed-out");
        return;
      }
      setStatus("accepting");
      const { data: companyId, error: err } = await db.rpc("accept_company_invite", {
        _token: token,
      });
      if (cancelled) return;
      if (err) {
        setStatus("error");
        setError(err.message);
        return;
      }
      setStatus("accepted");
      localStorage.setItem("recon.lastCompany", companyId as string);
      setTimeout(() => {
        if (!cancelled)
          navigate({
            to: "/reconciliation",
            search: { company: companyId as string, account: undefined },
            replace: true,
          });
      }, 1200);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="panel w-full max-w-md p-6 text-center">
        <p className="caption">Team invite</p>
        {status === "checking" && (
          <p className="mt-3 text-sm text-muted-foreground">Checking your invite…</p>
        )}
        {status === "signed-out" && (
          <>
            <h1 className="mt-1 text-lg font-semibold">Sign in to accept this invite</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You need an account with the email address this invite was sent to. After signing in,
              come back to this same link to finish joining.
            </p>
            <Link
              to="/auth"
              className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Sign in / create account
            </Link>
          </>
        )}
        {status === "accepting" && (
          <p className="mt-3 text-sm text-muted-foreground">Joining the company…</p>
        )}
        {status === "accepted" && (
          <>
            <h1 className="mt-1 text-lg font-semibold">You're in 🎉</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Taking you to the reconciliation workspace…
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="mt-1 text-lg font-semibold">Couldn't accept this invite</h1>
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <Link
              to="/select-company"
              className="mt-5 inline-block rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold hover:border-primary"
            >
              Go to workspace
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
