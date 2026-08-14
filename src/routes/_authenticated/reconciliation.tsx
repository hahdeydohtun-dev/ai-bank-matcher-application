import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  db,
  supabase,
  type AccountingRecord,
  type BankAccount,
  type BankTransaction,
  type Company,
  type ImportBatch,
  type MatchSuggestion,
} from "@/lib/recon/db";
import { useSettings } from "@/lib/recon/settings";
import { runMatching } from "@/lib/recon/matching";
import {
  logMatchDecision,
  loadMatchingWeights,
  recalibrateMatchingWeights,
  rowToWeights,
  type MatchingWeightsRow,
} from "@/lib/recon/matchDecisions";
import { StatCards, type StatKey } from "@/components/recon/StatCards";
import { TransactionList } from "@/components/recon/TransactionList";
import { SuggestionsPanel } from "@/components/recon/SuggestionsPanel";
import { ImportCsvDialog } from "@/components/recon/ImportCsvDialog";
import { DataSetsPanel } from "@/components/recon/DataSetsPanel";
import { MatchBoard } from "@/components/recon/MatchBoard";
import { CreateEntityDialog, type CreateMode } from "@/components/recon/CreateEntityDialog";
import { RejectReasonDialog, type RejectPrompt } from "@/components/recon/RejectReasonDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  validateSearch: (search: Record<string, unknown>): { company?: string; account?: string } => ({
    company: typeof search.company === "string" ? search.company : undefined,
    account: typeof search.account === "string" ? search.account : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Bank Reconciliation Workspace" },
      {
        name: "description",
        content:
          "Score, review and approve bank-to-ledger matches with AI confidence, live sync and CSV import.",
      },
      { property: "og:title", content: "Bank Reconciliation Workspace" },
      {
        property: "og:description",
        content:
          "AI-matched bank statement lines against ledger records, live for your whole team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReconciliationPage,
});

const EMPTY_STATS: Record<StatKey, number> = {
  total: 0,
  auto: 0,
  review: 0,
  unmatched: 0,
  highvalue: 0,
  duplicate: 0,
  aging: 0,
  reconciled: 0,
};

function ReconciliationPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [email, setEmail] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyIdState] = useState<string>("");
  const [settings] = useSettings(companyId);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [linkedAccountIds, setLinkedAccountIds] = useState<Set<string>>(new Set());
  const [accountId, setAccountIdState] = useState<string>("");
  // False until the account for the current company has been resolved (URL param
  // or most-recently-used). Data loading waits for it so the first fetch is
  // never company-wide (which showed every account's data sets after a reload).
  const [accountReady, setAccountReady] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [records, setRecords] = useState<AccountingRecord[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [view, setView] = useState<"list" | "board">("list");
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [rejectPrompt, setRejectPrompt] = useState<RejectPrompt | null>(null);

  const [showDataSets, setShowDataSets] = useState(false);
  const [merging, setMerging] = useState(false);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [partyType, setPartyType] = useState("all");
  const [activeStat, setActiveStat] = useState<StatKey>("total");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchWeightsRow, setMatchWeightsRow] = useState<MatchingWeightsRow | null>(null);
  const [recalibrating, setRecalibrating] = useState(false);
  const [lastBulk, setLastBulk] = useState<{
    label: string;
    entries: Array<{
      txn: {
        id: string;
        status: string;
        reconciled_record_id: string | null;
        resolved_by_email: string | null;
        resolved_at: string | null;
      };
      record?: {
        id: string;
        status: string;
        reconciled_txn_id: string | null;
        resolved_by_email: string | null;
        resolved_at: string | null;
      };
      suggestion?: { bank_transaction_id: string; status: string };
    }>;
  } | null>(null);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const currency = company?.currency ?? "NGN";

  /* ---------------- bootstrap ---------------- */
  useEffect(() => {
    setView(settings.defaultView);
    setPanelOpen(settings.showAiPanel);
  }, [settings.defaultView, settings.showAiPanel]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  // URL-writing setters keep company/account selection shareable and
  // survive hard refreshes.
  const setCompanyId = useCallback(
    (id: string) => {
      setCompanyIdState(id);
      setAccountIdState("");
      void navigate({
        to: "/reconciliation",
        search: { company: id || undefined, account: undefined },
        replace: true,
      });
    },
    [navigate],
  );
  const setAccountId = useCallback(
    (id: string) => {
      setAccountIdState(id);
      void navigate({
        to: "/reconciliation",
        search: (prev: { company?: string; account?: string }) => ({
          ...prev,
          account: id || undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  useEffect(() => {
    db.from("companies")
      .select("*")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Company[];
        setCompanies(list);

        // Deep-link safety: if URL points at a company the user can't access,
        // bounce to the picker with a toast instead of silently swapping.
        if (search.company && !list.find((c) => c.id === search.company)) {
          toast.error("That company isn't available to your account.");
          void navigate({ to: "/select-company", replace: true });
          return;
        }

        // Prefer URL, then last-used company from localStorage, else picker.
        const lastPicked = localStorage.getItem("recon.lastCompany");
        const chosen =
          list.find((c) => c.id === search.company)?.id ||
          list.find((c) => c.id === lastPicked)?.id ||
          "";

        if (!chosen && list.length > 1) {
          void navigate({ to: "/select-company", replace: true });
          return;
        }
        const final = chosen || list[0]?.id || "";
        setCompanyIdState((prev) => prev || final);
        if (final) localStorage.setItem("recon.lastCompany", final);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist last-used company & cross-tab sync.
  useEffect(() => {
    if (companyId) localStorage.setItem("recon.lastCompany", companyId);
  }, [companyId]);

  // Learned per-company matching weights (from prior AI Suggest recalibrations).
  // Falls back to the built-in default blend until a company has accumulated
  // enough accept/reject history (see matchDecisions.ts).
  useEffect(() => {
    if (!companyId) {
      setMatchWeightsRow(null);
      return;
    }
    let cancelled = false;
    void loadMatchingWeights(companyId).then((row) => {
      if (!cancelled) setMatchWeightsRow(row);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "recon.lastCompany" || !e.newValue) return;
      if (e.newValue === companyId) return;
      // Another tab switched company — follow along.
      void navigate({
        to: "/reconciliation",
        search: { company: e.newValue, account: undefined },
        replace: true,
      });
      setCompanyIdState(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [companyId, navigate]);

  // Load ALL bank accounts + a set of accounts linked to the current company.
  // Non-linked accounts stay in the dropdown but disabled with a tooltip so
  // users see the full inventory without being able to select cross-company.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setAccountReady(false);
    Promise.all([
      db.from("bank_accounts").select("*"),
      db.from("bank_account_companies").select("bank_account_id").eq("company_id", companyId),
    ]).then(([allRes, linkRes]) => {
      if (cancelled) return;
      const all = ((allRes.data ?? []) as BankAccount[])
        .slice()
        .sort((a, b) => (a.bank_name ?? "").localeCompare(b.bank_name ?? ""));
      const linked = new Set(
        ((linkRes.data ?? []) as { bank_account_id: string }[]).map((r) => r.bank_account_id),
      );
      setAccounts(all);
      setLinkedAccountIds(linked);

      // Prefer URL param if it's a linked account, else most recently used
      // for this company (from import_batches), else first linked, else empty.
      const urlAccount = search.account && linked.has(search.account) ? search.account : "";
      if (urlAccount) {
        setAccountIdState(urlAccount);
        setAccountReady(true);
        return;
      }
      db.from("import_batches")
        .select("bank_account_id, created_at")
        .eq("company_id", companyId)
        .not("bank_account_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (cancelled) return;
          const recent = ((data ?? []) as { bank_account_id: string | null }[])
            .map((r) => r.bank_account_id)
            .find((id): id is string => !!id && linked.has(id));
          const firstLinked = all.find((a) => linked.has(a.id))?.id ?? "";
          const next = recent ?? firstLinked;
          setAccountIdState(next);
          setAccountReady(true);
          if (next) {
            void navigate({
              to: "/reconciliation",
              search: (prev: { company?: string; account?: string }) => ({
                ...prev,
                account: next,
              }),
              replace: true,
            });
          }
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const loadData = useCallback(async () => {
    if (!companyId || !accountReady) return;

    // Clear all workspace data BEFORE the fetch so a stale account's rows
    // never flash under the newly selected account while loading.
    setSwitching(true);
    setRecords([]);
    setTransactions([]);
    setSuggestions([]);
    setBatches([]);
    setSelectedId(null);
    // The Data API caps a single response at 1000 rows, so every list is read
    // in pages until a short page comes back — otherwise large statements
    // silently truncate on the match board.
    const PAGE = 1000;
    async function fetchAll<T>(
      build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>,
    ): Promise<T[]> {
      const out: T[] = [];
      for (let page = 0; ; page += 1) {
        const { data } = await build(page * PAGE, page * PAGE + PAGE - 1);
        const chunk = (data ?? []) as T[];
        out.push(...chunk);
        if (chunk.length < PAGE) return out;
      }
    }
    try {
      const [recRows, txnRows, sugRows, batchRows] = await Promise.all([
        fetchAll<AccountingRecord>((from, to) => {
          let q = db
            .from("accounting_records")
            .select("*")
            .eq("company_id", companyId)
            .order("doc_date", { ascending: false })
            .range(from, to);
          if (accountId) q = q.eq("bank_account_id", accountId);
          return q;
        }),
        fetchAll<BankTransaction>((from, to) => {
          let q = db
            .from("bank_transactions")
            .select("*")
            .eq("company_id", companyId)
            .order("txn_date", { ascending: false })
            .range(from, to);
          if (accountId) q = q.eq("bank_account_id", accountId);
          return q;
        }),
        fetchAll<MatchSuggestion>((from, to) =>
          db
            .from("match_suggestions")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .range(from, to),
        ),
        fetchAll<ImportBatch>((from, to) => {
          let q = db
            .from("import_batches")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .range(from, to);
          if (accountId) q = q.eq("bank_account_id", accountId);
          return q;
        }),
      ]);
      setRecords(recRows);
      setTransactions(txnRows);
      setSuggestions(sugRows);
      setBatches(batchRows);
    } finally {
      setSwitching(false);
    }
  }, [companyId, accountId, accountReady]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  /* ---------------- realtime ---------------- */
  useEffect(() => {
    if (!companyId || !settings.liveSync) return;
    const channel = supabase
      .channel(`recon-${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bank_transactions",
          filter: `company_id=eq.${companyId}`,
        },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_suggestions",
          filter: `company_id=eq.${companyId}`,
        },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accounting_records",
          filter: `company_id=eq.${companyId}`,
        },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "import_batches",
          filter: `company_id=eq.${companyId}`,
        },
        () => void loadData(),
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
      setLive(false);
    };
  }, [companyId, loadData, settings.liveSync]);

  /* ---------------- derived ---------------- */
  const recordMap = useMemo(() => Object.fromEntries(records.map((r) => [r.id, r])), [records]);
  const suggestionMap = useMemo(
    () => Object.fromEntries(suggestions.map((s) => [s.bank_transaction_id, s])),
    [suggestions],
  );

  const scoped = useMemo(() => {
    return transactions.filter((txn) => {
      const txnDate = txn.txn_date ?? "";
      const isUnreconciled = txn.status !== "reconciled";
      const beforeFrom = fromDate ? txnDate && txnDate < fromDate : false;
      const afterTo = toDate ? txnDate && txnDate > toDate : false;
      // Prior-period unreconciled items carry into the current window.
      if (beforeFrom && !isUnreconciled) return false;
      if (afterTo) return false;
      if (partyType !== "all") {
        const suggestion = suggestionMap[txn.id];
        const record = suggestion?.accounting_record_id
          ? recordMap[suggestion.accounting_record_id]
          : null;
        if ((record?.party_type ?? "") !== partyType) return false;
      }
      return true;
    });
  }, [transactions, fromDate, toDate, partyType, suggestionMap, recordMap]);

  const statOf = (txn: BankTransaction): StatKey | null =>
    txn.status === "reconciled" ? "reconciled" : ((txn.category as StatKey) ?? null);

  const counts = useMemo(() => {
    const c: Record<StatKey, number> = { ...EMPTY_STATS };
    const v: Record<StatKey, number> = { ...EMPTY_STATS };
    for (const txn of scoped) {
      c.total += 1;
      v.total += Number(txn.amount);
      const key = statOf(txn);
      if (key) {
        c[key] += 1;
        v[key] += Number(txn.amount);
      }
    }
    return { counts: c, values: v };
  }, [scoped]);

  const visible = useMemo(() => {
    if (activeStat === "total") return scoped;
    return scoped.filter((txn) => statOf(txn) === activeStat);
  }, [scoped, activeStat]);

  const pendingAuto = scoped.filter((t) => t.category === "auto" && t.status === "unreconciled");

  const partyTypes = useMemo(
    () => Array.from(new Set(records.map((r) => r.party_type).filter(Boolean))) as string[],
    [records],
  );

  /* ---------------- actions ---------------- */
  async function runAiSuggest() {
    if (!companyId) return;
    setRunning(true);
    setError(null);
    try {
      const targets = scoped.filter((t) => t.status === "unreconciled");
      const openRecords = records.filter((r) => (r.status ?? "open") === "open");
      const results = runMatching(targets, openRecords, {
        autoThreshold: settings.autoThreshold,
        reviewThreshold: settings.reviewThreshold,
        highValueThreshold: settings.highValueThreshold,
        agingDays: settings.agingDays,
        bankChargeAutoMatch: settings.bankChargeAutoMatch,
        chargeKeywords: settings.bankChargeKeywords,
        chargeTolerance: settings.chargeTolerance,
        weights: rowToWeights(matchWeightsRow),
      });

      const suggestionRows = results.map((r) => ({
        company_id: companyId,
        bank_transaction_id: r.transaction.id,
        accounting_record_id: r.record?.id ?? null,
        confidence: Number((r.scores?.confidence ?? 0).toFixed(2)),
        amount_score: Number((r.scores?.amount ?? 0).toFixed(2)),
        reference_score: Number((r.scores?.reference ?? 0).toFixed(2)),
        date_score: Number((r.scores?.date ?? 0).toFixed(2)),
        party_score: Number((r.scores?.party ?? 0).toFixed(2)),
        side_score: Number((r.scores?.side ?? 0).toFixed(2)),
        status: "pending",
      }));

      if (suggestionRows.length) {
        const { error: sErr } = await db
          .from("match_suggestions")
          .upsert(suggestionRows, { onConflict: "bank_transaction_id" });
        if (sErr) throw sErr;
      }

      await Promise.all(
        results.map((r) =>
          db
            .from("bank_transactions")
            .update({
              category: r.category,
              ai_confidence: Number((r.scores?.confidence ?? 0).toFixed(2)),
            })
            .eq("id", r.transaction.id),
        ),
      );

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI Suggest failed");
    } finally {
      setRunning(false);
    }
  }

  async function resolve(
    txn: BankTransaction,
    accept: boolean,
    recordIdOverride?: string | null,
    reason?: string | null,
  ) {
    setBusyId(txn.id);
    setError(null);
    try {
      const suggestion = suggestionMap[txn.id];
      const recordId =
        recordIdOverride !== undefined
          ? recordIdOverride
          : (suggestion?.accounting_record_id ?? null);
      const { error: err } = await db
        .from("bank_transactions")
        .update({
          status: accept ? "reconciled" : "rejected",
          reconciled_record_id: accept ? recordId : null,
          resolved_by_email: email,
          resolved_at: new Date().toISOString(),
          rejection_reason: accept ? null : reason?.trim() || null,
        })
        .eq("id", txn.id);
      if (err) throw err;

      if (accept && recordId) {
        await db
          .from("accounting_records")
          .update({
            status: "reconciled",
            reconciled_txn_id: txn.id,
            resolved_by_email: email,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", recordId);
      }

      if (suggestion) {
        await db
          .from("match_suggestions")
          .update({
            status: accept ? "accepted" : "rejected",
            rejection_reason: accept ? null : reason?.trim() || null,
          })
          .eq("bank_transaction_id", txn.id);
      }

      // Log the human decision for the adaptive weight learner. Uses the
      // suggestion's own sub-scores when this was an AI-suggested pairing
      // (whether accepted or rejected — rejections are just as informative);
      // otherwise scores the manually-chosen pairing from scratch.
      const decisionRecordId = accept ? recordId : (suggestion?.accounting_record_id ?? recordId);
      const decisionRecord = decisionRecordId ? recordMap[decisionRecordId] : null;
      if (decisionRecord) {
        void logMatchDecision({
          companyId,
          txn,
          record: decisionRecord,
          accepted: accept,
          source: suggestion ? "suggestion" : "manual",
          decidedByEmail: email || null,
          scores:
            suggestion && suggestion.accounting_record_id === decisionRecordId
              ? {
                  amount: suggestion.amount_score,
                  reference: suggestion.reference_score,
                  date: suggestion.date_score,
                  party: suggestion.party_score,
                  side: suggestion.side_score,
                  confidence: suggestion.confidence,
                }
              : null,
        });
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the transaction");
    } finally {
      setBusyId(null);
    }
  }

  function snapshotFor(txn: BankTransaction) {
    const suggestion = suggestionMap[txn.id];
    const recordId = suggestion?.accounting_record_id ?? txn.reconciled_record_id ?? null;
    const record = recordId ? recordMap[recordId] : null;
    return {
      txn: {
        id: txn.id,
        status: txn.status,
        reconciled_record_id: txn.reconciled_record_id ?? null,
        resolved_by_email: txn.resolved_by_email ?? null,
        resolved_at: txn.resolved_at ?? null,
      },
      record: record
        ? {
            id: record.id,
            status: record.status ?? "open",
            reconciled_txn_id: record.reconciled_txn_id ?? null,
            resolved_by_email: record.resolved_by_email ?? null,
            resolved_at: record.resolved_at ?? null,
          }
        : undefined,
      suggestion: suggestion
        ? { bank_transaction_id: txn.id, status: suggestion.status }
        : undefined,
    };
  }

  async function recalibrate() {
    if (!companyId) return;
    setRecalibrating(true);
    setError(null);
    try {
      const result = await recalibrateMatchingWeights(companyId, rowToWeights(matchWeightsRow));
      if (!result.applied) {
        toast.info("Not enough history to recalibrate yet", {
          description: `${result.sampleSize} decision${result.sampleSize === 1 ? "" : "s"} logged so far — need at least 20.`,
        });
        return;
      }
      const row = await loadMatchingWeights(companyId);
      setMatchWeightsRow(row);
      toast.success("Matching weights recalibrated", {
        description: `Learned from ${result.sampleSize} accept/reject decisions. Suggested thresholds: auto ${result.suggestedAutoThreshold}%, review ${result.suggestedReviewThreshold}%.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalibration failed");
    } finally {
      setRecalibrating(false);
    }
  }

  async function bulkApproveAuto() {
    setRunning(true);
    const entries: NonNullable<typeof lastBulk>["entries"] = [];
    const unreconciled = scoped.filter((t) => t.status === "unreconciled");
    const eligible = unreconciled.filter((t) => t.category === "auto");
    const skipped = unreconciled.length - eligible.length;
    try {
      for (const txn of eligible) {
        entries.push(snapshotFor(txn));

        await resolve(txn, true);
      }
      if (entries.length) {
        setLastBulk({ label: `Bulk Approve Auto (${entries.length})`, entries });
      }
      toast.success(
        `Auto-approved ${entries.length} suggestion${entries.length === 1 ? "" : "s"}`,
        {
          description:
            skipped > 0
              ? `${skipped} skipped — below auto-match confidence threshold`
              : "All eligible suggestions approved",
        },
      );
    } finally {
      setRunning(false);
    }
  }

  async function bulkResolveSelected(txnIds: string[], accept: boolean, reason?: string | null) {
    setRunning(true);
    const entries: NonNullable<typeof lastBulk>["entries"] = [];
    try {
      for (const id of txnIds) {
        const txn = transactions.find((t) => t.id === id);
        if (!txn) continue;
        entries.push(snapshotFor(txn));

        await resolve(txn, accept, undefined, reason);
      }

      if (entries.length) {
        setLastBulk({
          label: `${accept ? "Accept" : "Reject"} selected (${entries.length})`,
          entries,
        });
      }
    } finally {
      setRunning(false);
    }
  }

  async function undoLastBulk() {
    if (!lastBulk || !lastBulk.entries.length) return;
    setRunning(true);
    setError(null);
    try {
      for (const entry of lastBulk.entries) {
        await db
          .from("bank_transactions")
          .update({
            status: entry.txn.status,
            reconciled_record_id: entry.txn.reconciled_record_id,
            resolved_by_email: entry.txn.resolved_by_email,
            resolved_at: entry.txn.resolved_at,
          })
          .eq("id", entry.txn.id);
        if (entry.record) {
          await db
            .from("accounting_records")
            .update({
              status: entry.record.status,
              reconciled_txn_id: entry.record.reconciled_txn_id,
              resolved_by_email: entry.record.resolved_by_email,
              resolved_at: entry.record.resolved_at,
            })
            .eq("id", entry.record.id);
        }
        if (entry.suggestion) {
          await db
            .from("match_suggestions")
            .update({ status: entry.suggestion.status })
            .eq("bank_transaction_id", entry.suggestion.bank_transaction_id);
        }
      }
      setLastBulk(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setRunning(false);
    }
  }

  async function mergeReconcile(txnIds: string[], recordIds: string[], note: string) {
    if (!txnIds.length || !recordIds.length) return;
    setMerging(true);
    setError(null);
    try {
      const groupId = crypto.randomUUID();
      const bankTotal = txnIds.reduce(
        (sum, id) => sum + Math.abs(Number(transactions.find((t) => t.id === id)?.amount ?? 0)),
        0,
      );
      const ledgerTotal = recordIds.reduce(
        (sum, id) => sum + Math.abs(Number(records.find((r) => r.id === id)?.amount ?? 0)),
        0,
      );

      const { error: gErr } = await db.from("match_groups").insert({
        id: groupId,
        company_id: companyId,
        bank_transaction_ids: txnIds,
        accounting_record_ids: recordIds,
        bank_total: Number(bankTotal.toFixed(2)),
        ledger_total: Number(ledgerTotal.toFixed(2)),
        difference: Number((bankTotal - ledgerTotal).toFixed(2)),
        note: note || null,
        status: "reconciled",
        created_by_email: email,
      });
      if (gErr) throw gErr;

      const now = new Date().toISOString();
      const { error: tErr } = await db
        .from("bank_transactions")
        .update({
          status: "reconciled",
          match_group_id: groupId,
          reconciled_record_id: recordIds.length === 1 ? recordIds[0] : null,
          manually_reconciled: true,
          resolved_by_email: email,
          resolved_at: now,
        })
        .in("id", txnIds);
      if (tErr) throw tErr;

      const { error: rErr } = await db
        .from("accounting_records")
        .update({
          status: "reconciled",
          match_group_id: groupId,
          reconciled_txn_id: txnIds.length === 1 ? txnIds[0] : null,
          resolved_by_email: email,
          resolved_at: now,
        })
        .in("id", recordIds);
      if (rErr) throw rErr;

      // Only a clean 1:1 pairing has an unambiguous sub-score to learn from;
      // skip logging for N:M merges rather than guessing which side paired
      // with which.
      if (txnIds.length === 1 && recordIds.length === 1) {
        const txn = transactions.find((t) => t.id === txnIds[0]);
        const record = recordMap[recordIds[0]];
        if (txn && record) {
          void logMatchDecision({
            companyId,
            txn,
            record,
            accepted: true,
            source: "manual",
            decidedByEmail: email || null,
          });
        }
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge reconciliation failed");
    } finally {
      setMerging(false);
    }
  }

  async function resetWorkspace() {
    if (
      settings.confirmDestructive &&
      !window.confirm(
        "Reset clears AI categories, confidence, merges and suggestions for the whole shared workspace. Continue?",
      )
    )
      return;
    setRunning(true);
    setError(null);
    try {
      const { error: tErr } = await db
        .from("bank_transactions")
        .update({
          status: "unreconciled",
          category: null,
          ai_confidence: null,
          reconciled_record_id: null,
          match_group_id: null,
          resolved_by_email: null,
          resolved_at: null,
        })
        .eq("company_id", companyId)
        .eq("manually_reconciled", false);
      if (tErr) throw tErr;

      await db
        .from("accounting_records")
        .update({
          status: "open",
          match_group_id: null,
          reconciled_txn_id: null,
          resolved_by_email: null,
          resolved_at: null,
        })
        .eq("company_id", companyId);

      await db.from("match_groups").delete().eq("company_id", companyId);

      const { error: sErr } = await db
        .from("match_suggestions")
        .delete()
        .eq("company_id", companyId);
      if (sErr) throw sErr;

      setActiveStat("total");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setRunning(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const period =
    fromDate || toDate ? `${fromDate || "start"} → ${toDate || "today"}` : "All periods";

  return (
    <div className="min-h-screen bg-background">
      {/* top bar */}
      <header className="border-b border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="caption">Accounting → Bank Reconciliation Tool</p>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-success" : "bg-warning"}`} />
              {live ? "Live sync on" : "Connecting…"}
            </span>
            <span className="mono">
              {company?.name ?? "—"} · {currency}
            </span>
            <span className="mono">{email}</span>
            <Link
              to="/select-company"
              search={{ force: "1" }}
              className="rounded-md border border-border-strong px-2 py-1 hover:border-primary hover:text-primary"
            >
              Switch company
            </Link>
            <Link
              to="/control-panel"
              className="rounded-md border border-border-strong px-2 py-1 hover:border-primary hover:text-primary"
            >
              Control panel
            </Link>
            <button
              onClick={signOut}
              className="rounded-md border border-border-strong px-2 py-1 hover:border-destructive hover:text-destructive"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-5 xl:flex-row">
        {/* main column */}
        <main className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Bank Reconciliation</h1>
              {/* Breadcrumb: Company › Bank Account › Period. Each segment is a
                  live selector — Company/Account jump the dropdowns into focus,
                  Period clears the date range. */}
              <nav
                aria-label="Selection breadcrumb"
                className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => document.getElementById("recon-company-select")?.focus()}
                  className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
                >
                  {company?.name ?? "Select company"}
                </button>
                <span aria-hidden>›</span>
                <button
                  type="button"
                  onClick={() => document.getElementById("recon-account-select")?.focus()}
                  className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
                >
                  {account
                    ? `${account.bank_name} · ${account.account_number}`
                    : "Select bank account"}
                </button>
                <span aria-hidden>›</span>
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                  }}
                  className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
                  title="Clear period"
                >
                  {period}
                </button>
                <span className="text-muted-foreground">· {scoped.length} transactions</span>
              </nav>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex overflow-hidden rounded-lg border border-border-strong">
                {(["list", "board"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-2 text-xs font-semibold ${
                      view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {v === "list" ? "Transaction list" : "Match board"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowDataSets((v) => !v)}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
              >
                Data sets ({batches.length})
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary"
              >
                Import data
              </button>
              <button
                onClick={resetWorkspace}
                disabled={running}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={runAiSuggest}
                disabled={running}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Working…" : "AI Suggest"}
              </button>
              <button
                onClick={() => void recalibrate()}
                disabled={recalibrating || !companyId}
                title={
                  matchWeightsRow
                    ? `Last recalibrated from ${matchWeightsRow.sample_size} decisions`
                    : "Learns matching weights from your team's accept/reject history"
                }
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold hover:border-primary disabled:opacity-50"
              >
                {recalibrating ? "Recalibrating…" : "Recalibrate weights"}
              </button>
              <button
                onClick={bulkApproveAuto}
                disabled={running || !pendingAuto.length}
                className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-40"
              >
                Bulk Approve Auto ({pendingAuto.length})
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {/* filters */}
          <div className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="caption" htmlFor="recon-company-select">
                Company
              </label>
              <select
                id="recon-company-select"
                className="field mt-1"
                value={companyId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCreateMode("company");
                    return;
                  }
                  setCompanyId(e.target.value);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new__">+ Create new company…</option>
              </select>
            </div>
            <div>
              <label className="caption" htmlFor="recon-account-select">
                Bank account
              </label>
              <select
                id="recon-account-select"
                className="field mt-1"
                value={accountId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCreateMode("account");
                    return;
                  }
                  setAccountId(e.target.value);
                }}
              >
                {!accountId && <option value="">— Select bank account —</option>}
                {accounts.map((a) => {
                  const linked = linkedAccountIds.has(a.id);
                  return (
                    <option
                      key={a.id}
                      value={a.id}
                      disabled={!linked}
                      title={linked ? undefined : "Not linked to this company"}
                    >
                      {a.bank_name} · {a.account_number}
                      {linked ? "" : " (unlinked)"}
                    </option>
                  );
                })}
                <option value="__new__">+ Create new bank account…</option>
              </select>
            </div>
            <div>
              <label className="caption">From</label>
              <input
                type="date"
                className="field mt-1"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="caption">To</label>
              <input
                type="date"
                className="field mt-1"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div>
              <label className="caption">Party type</label>
              <select
                className="field mt-1"
                value={partyType}
                onChange={(e) => setPartyType(e.target.value)}
              >
                <option value="all">All parties</option>
                {partyTypes.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showDataSets && (
            <DataSetsPanel
              batches={batches}
              companyId={companyId}
              bankAccountId={accountId || null}
              confirmDestructive={settings.confirmDestructive}
              onChanged={() => void loadData()}
              onImport={() => setImportOpen(true)}
            />
          )}

          <StatCards
            counts={counts.counts}
            values={counts.values}
            active={activeStat}
            currency={currency}
            onSelect={setActiveStat}
          />

          {switching ? (
            <div className="panel space-y-2 p-4" aria-busy="true" aria-live="polite">
              <p className="caption">Loading data for the selected bank account…</p>
              <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-24 w-full animate-pulse rounded bg-muted" />
              <div className="h-24 w-full animate-pulse rounded bg-muted" />
              <div className="h-24 w-full animate-pulse rounded bg-muted" />
            </div>
          ) : view === "list" ? (
            <TransactionList
              transactions={visible}
              currency={currency}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setPanelOpen(true);
              }}
            />
          ) : (
            <MatchBoard
              transactions={scoped}
              records={records}
              suggestions={suggestionMap}
              currency={currency}
              busyId={busyId}
              merging={merging}
              onAccept={(txn, recordId) => void resolve(txn, true, recordId)}
              onReject={(txn) => setRejectPrompt({ scope: "single", ids: [txn.id] })}
              onMerge={(txnIds, recordIds, note) => void mergeReconcile(txnIds, recordIds, note)}
              running={running}
              pendingAutoCount={pendingAuto.length}
              onAiSuggest={() => void runAiSuggest()}
              onBulkApprove={() => void bulkApproveAuto()}
              onBulkAccept={(ids) => void bulkResolveSelected(ids, true)}
              onBulkReject={(ids) => ids.length && setRejectPrompt({ scope: "bulk", ids })}
            />
          )}
        </main>

        {/* right sidebar */}
        <div className={panelOpen ? "w-full xl:w-[26rem]" : "w-full xl:w-12"}>
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className="rounded-md border border-border-strong px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:border-primary"
            >
              {panelOpen ? "Collapse panel" : "AI panel"}
            </button>
          </div>
          {panelOpen && (
            <div className="h-[calc(100vh-11rem)] xl:sticky xl:top-5">
              <SuggestionsPanel
                transactions={visible}
                suggestions={suggestionMap}
                records={recordMap}
                currency={currency}
                activeCategory={activeStat}
                counts={counts.counts}
                selectedId={selectedId}
                onSelectCategory={setActiveStat}
                onAccept={(txn) => void resolve(txn, true)}
                onReject={(txn) => setRejectPrompt({ scope: "single", ids: [txn.id] })}
                onBulkAccept={(ids) => void bulkResolveSelected(ids, true)}
                onBulkReject={(ids) => ids.length && setRejectPrompt({ scope: "bulk", ids })}
                onBulkApproveAuto={() => void bulkApproveAuto()}
                onUndoLastBulk={() => void undoLastBulk()}
                undoLabel={lastBulk?.label ?? null}
                pendingAutoCount={pendingAuto.length}
                running={running}
                busyId={busyId}
              />
            </div>
          )}
        </div>
      </div>

      <CreateEntityDialog
        mode={createMode}
        companyId={companyId}
        onClose={() => setCreateMode(null)}
        onCreated={(kind, id) => {
          if (kind === "company") {
            db.from("companies")
              .select("*")
              .order("name")
              .then(({ data }) => {
                setCompanies((data ?? []) as Company[]);
                setCompanyId(id);
              });
          } else {
            // Refetch all accounts + linked set so the new bank account shows
            // up in the dropdown as linked to the current company.
            Promise.all([
              db.from("bank_accounts").select("*"),
              db
                .from("bank_account_companies")
                .select("bank_account_id")
                .eq("company_id", companyId),
            ]).then(([allRes, linkRes]) => {
              const all = ((allRes.data ?? []) as BankAccount[])
                .slice()
                .sort((a, b) => (a.bank_name ?? "").localeCompare(b.bank_name ?? ""));
              setAccounts(all);
              setLinkedAccountIds(
                new Set(
                  ((linkRes.data ?? []) as { bank_account_id: string }[]).map(
                    (r) => r.bank_account_id,
                  ),
                ),
              );
              setAccountId(id);
            });
          }
        }}
      />

      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        companyId={companyId}
        bankAccountId={accountId || null}
        onImported={() => void loadData()}
      />

      <RejectReasonDialog
        prompt={rejectPrompt}
        busy={running || busyId !== null}
        onCancel={() => setRejectPrompt(null)}
        onConfirm={(reason) => {
          if (!rejectPrompt) return;
          const { scope, ids } = rejectPrompt;
          setRejectPrompt(null);
          if (scope === "single") {
            const txn = transactions.find((t) => t.id === ids[0]);
            if (txn) void resolve(txn, false, undefined, reason);
          } else {
            void bulkResolveSelected(ids, false, reason);
          }
        }}
      />
    </div>
  );
}
