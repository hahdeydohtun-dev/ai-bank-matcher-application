import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Bank Reconciliation" },
      {
        name: "description",
        content:
          "Sign in to the AI bank reconciliation workspace to match statement lines against your ledger.",
      },
      { property: "og:title", content: "Sign in · Bank Reconciliation" },
      {
        property: "og:description",
        content: "Access your team's AI-assisted bank reconciliation workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/select-company", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        const { data } = await supabase.auth.getSession();
        if (data.session) navigate({ to: "/select-company", replace: true });
        else setMessage("Check your inbox to confirm your address, then sign in.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        navigate({ to: "/select-company", replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6">
        <p className="caption">Accounting</p>
        <h1 className="mt-1 text-xl font-semibold">Bank Reconciliation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to your workspace."
            : "Create an account to join the demo workspace."}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="caption" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field mt-1"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="caption" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field mt-1"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {message && <p className="text-xs text-success">{message}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-primary"
        >
          {mode === "signin"
            ? "No account yet? Create one"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
