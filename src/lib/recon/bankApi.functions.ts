import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractRows, flattenRow, pick, toDate, toNumber } from "@/lib/recon/bankApi.parse";
import { guardIngestPeriod, isCovered } from "@/lib/recon/ingestGuard";

export type FetchStatementInput = {
  companyId: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  /** When true, fetch and return raw rows for preview without writing anything. */
  preview?: boolean;
};

export const fetchBankStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FetchStatementInput) => {
    if (!input?.companyId) throw new Error("Select a company first.");
    if (!input?.bankAccountId) throw new Error("Select a bank account first.");
    if (!input?.periodStart || !input?.periodEnd)
      throw new Error("Pick a period start and end date.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { companyId, bankAccountId, periodStart, periodEnd } = data;

    // Membership + link check runs as the user, under RLS.
    const { data: configRow, error: configErr } = await supabase
      .from("bank_api_connections")
      .select("id, enabled, endpoint_url, auth_type, provider_label")
      .eq("company_id", companyId)
      .eq("bank_account_id", bankAccountId)
      .maybeSingle();
    if (configErr) throw new Error(configErr.message);
    if (!configRow) throw new Error("No bank portal connection is configured for this account.");
    if (!configRow.enabled) throw new Error("The bank portal connection for this account is off.");

    // Credentials are write-only for app users; read them with the service role.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: secretRow, error: secretErr } = await supabaseAdmin
      .from("bank_api_connections")
      .select("api_key, api_secret, extra_headers")
      .eq("id", configRow.id)
      .maybeSingle();
    if (secretErr) throw new Error(secretErr.message);

    const headers = new Headers({ Accept: "application/json" });
    const extra = (secretRow?.extra_headers ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const apiKey = secretRow?.api_key ?? "";
    const apiSecret = secretRow?.api_secret ?? "";
    switch (configRow.auth_type) {
      case "basic":
        headers.set(
          "Authorization",
          `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
        );
        break;
      case "api_key":
        if (apiKey) headers.set("x-api-key", apiKey);
        break;
      case "none":
        break;
      default:
        if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
    }

    let url: URL;
    try {
      url = new URL(configRow.endpoint_url);
    } catch {
      throw new Error("The configured endpoint URL is not valid.");
    }
    url.searchParams.set("from", periodStart);
    url.searchParams.set("to", periodEnd);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), { headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        err instanceof Error && err.name === "AbortError"
          ? "The bank portal timed out after 30s."
          : `Could not reach the bank portal: ${err instanceof Error ? err.message : "network error"}`,
      );
    }
    clearTimeout(timer);

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Bank portal returned ${response.status}: ${bodyText.slice(0, 300) || response.statusText}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new Error("Bank portal returned a non-JSON response.");
    }

    const rawRows = extractRows(payload);
    if (data.preview) {
      return {
        inserted: 0,
        skipped: 0,
        dataSetId: null as string | null,
        rows: rawRows.map(flattenRow),
      };
    }
    if (!rawRows.length)
      return {
        inserted: 0,
        skipped: 0,
        dataSetId: null as string | null,
        rows: [] as Record<string, string>[],
      };

    const dataSetId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    let skipped = 0;

    const rows = rawRows
      .map((row) => {
        const txnDate = toDate(
          pick(row, ["date", "postdate", "postingdate", "transactiondate", "bookingdate"]),
        );
        const valueDate = toDate(pick(row, ["valuedate", "effectivedate"])) ?? txnDate;
        const debit = toNumber(pick(row, ["debit", "debitamount", "withdrawal", "dr"]));
        const credit = toNumber(pick(row, ["credit", "creditamount", "deposit", "cr"]));
        const signed = toNumber(pick(row, ["amount", "value", "transactionamount"]));
        let amount: number | null = null;
        let direction: "debit" | "credit" | null = null;
        if (debit && debit !== 0) {
          amount = Math.abs(debit);
          direction = "debit";
        } else if (credit && credit !== 0) {
          amount = Math.abs(credit);
          direction = "credit";
        } else if (signed && signed !== 0) {
          amount = Math.abs(signed);
          const explicit = (
            pick(row, ["direction", "type", "drcr", "transactiontype"]) ?? ""
          ).toLowerCase();
          direction = /deb|dr|withdraw|out/.test(explicit)
            ? "debit"
            : /cred|cr|deposit|in/.test(explicit)
              ? "credit"
              : signed < 0
                ? "debit"
                : "credit";
        }
        const txnRef =
          pick(row, [
            "reference",
            "transactionreference",
            "ref",
            "txnref",
            "id",
            "transactionid",
          ]) ?? `API-${txnDate ?? periodStart}-${amount ?? 0}`;

        if (!txnDate || !amount || !direction) {
          skipped += 1;
          return null;
        }
        return {
          company_id: companyId,
          bank_account_id: bankAccountId,
          txn_ref: txnRef,
          amount,
          direction,
          txn_date: txnDate,
          value_date: valueDate,
          balance: toNumber(pick(row, ["balance", "runningbalance", "closingbalance"])),
          narration: pick(row, ["narration", "description", "details", "remarks", "memo"]) ?? null,
          status: "unreconciled",
          import_batch_id: batchId,
          data_set_id: dataSetId,
          period_start: periodStart,
          period_end: periodEnd,
          meta: JSON.parse(JSON.stringify(row)) as Record<string, never>,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (!rows.length)
      return {
        inserted: 0,
        skipped,
        dataSetId: null as string | null,
        rows: [] as Record<string, string>[],
      };

    const label = `${configRow.provider_label || "Bank portal"} fetch ${periodStart} → ${periodEnd}`;
    const { data: userRow } = await supabase.auth.getUser();
    const email = userRow?.user?.email ?? null;

    const idempotencyKey = `${companyId}|${bankAccountId}|bank_api|bank|${periodStart}|${periodEnd}`;

    // Periods only block a re-fetch while their rows still exist; overlapping
    // dates are skipped so an updated feed can top up the fresh days.
    const guard = await guardIngestPeriod(supabase, {
      companyId,
      bankAccountId,
      source: "bank",
      periodStart,
      periodEnd,
    });
    if (guard.fullyCovered) {
      return {
        inserted: 0,
        skipped,
        dataSetId: null as string | null,
        duplicate: true,
        rows: [] as Record<string, string>[],
      };
    }
    const freshRows = guard.covered.length
      ? rows.filter((r) => !isCovered(r.txn_date, guard.covered))
      : rows;
    skipped += rows.length - freshRows.length;
    if (!freshRows.length) {
      return {
        inserted: 0,
        skipped,
        dataSetId: null as string | null,
        duplicate: true,
        rows: [] as Record<string, string>[],
      };
    }
    const dates = freshRows.map((r) => r.txn_date).filter(Boolean) as string[];
    const setStart = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : periodStart;
    const setEnd = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : periodEnd;

    const { error: dsErr } = await supabase.from("data_sets").insert({
      id: dataSetId,
      company_id: companyId,
      bank_account_id: bankAccountId,
      source: "bank",
      period_start: setStart,
      period_end: setEnd,
      label,
      row_count: freshRows.length,
      created_by_email: email,
      idempotency_key: idempotencyKey,
    });
    if (dsErr) throw new Error(dsErr.message);

    const { error: batchErr } = await supabase.from("import_batches").insert({
      id: batchId,
      company_id: companyId,
      bank_account_id: bankAccountId,
      source: "bank",
      label,
      row_count: freshRows.length,
      created_by_email: email,
    });
    if (batchErr) throw new Error(batchErr.message);

    try {
      for (let i = 0; i < freshRows.length; i += 500) {
        const { error } = await supabase.from("bank_transactions").insert(freshRows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      await supabase.from("import_batches").delete().eq("id", batchId);
      await supabase.from("data_sets").delete().eq("id", dataSetId);
      throw err;
    }

    await supabaseAdmin
      .from("bank_api_connections")
      .update({ last_fetched_at: new Date().toISOString() })
      .eq("id", configRow.id);

    void userId;
    return {
      inserted: freshRows.length,
      skipped,
      dataSetId,
      duplicate: false,
      rows: [] as Record<string, string>[],
    };
  });
