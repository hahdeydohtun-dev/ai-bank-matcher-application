import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractRows, flattenRow, pick, toDate, toNumber } from "@/lib/recon/bankApi.parse";
import { guardIngestPeriod, isCovered } from "@/lib/recon/ingestGuard";
import { assertSafeOutboundUrl } from "@/lib/recon/urlGuard.server-lib";
import { assertCompanyAdmin } from "@/lib/recon/roleGuard.server-lib";

export type FetchLedgerInput = {
  companyId: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  /** When true, fetch and return raw rows for preview without writing anything. */
  preview?: boolean;
};

export const fetchErpLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FetchLedgerInput) => {
    if (!input?.companyId) throw new Error("Select a company first.");
    if (!input?.bankAccountId) throw new Error("Select a bank account first.");
    if (!input?.periodStart || !input?.periodEnd)
      throw new Error("Pick a period start and end date.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { companyId, bankAccountId, periodStart, periodEnd } = data;
    await assertCompanyAdmin(supabase, companyId, userId);

    const { data: configRow, error: configErr } = await supabase
      .from("erp_api_connections")
      .select("id, enabled, endpoint_url, auth_type, erp_system, gl_account_code")
      .eq("company_id", companyId)
      .eq("bank_account_id", bankAccountId)
      .maybeSingle();
    if (configErr) throw new Error(configErr.message);
    if (!configRow) throw new Error("No ERP connection is configured for this account.");
    if (!configRow.enabled) throw new Error("The ERP connection for this account is off.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: secretRow, error: secretErr } = await supabaseAdmin
      .from("erp_api_connections")
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

    const url = assertSafeOutboundUrl(configRow.endpoint_url);
    url.searchParams.set("from", periodStart);
    url.searchParams.set("to", periodEnd);
    if (configRow.gl_account_code) url.searchParams.set("account", configRow.gl_account_code);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), { headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        err instanceof Error && err.name === "AbortError"
          ? "The ERP API timed out after 30s."
          : `Could not reach the ERP API: ${err instanceof Error ? err.message : "network error"}`,
      );
    }
    clearTimeout(timer);

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `ERP API returned ${response.status}: ${bodyText.slice(0, 300) || response.statusText}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new Error("ERP API returned a non-JSON response.");
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
        const docDate = toDate(
          pick(row, ["postingdate", "date", "postdate", "entrydate", "transactiondate"]),
        );
        const debit = toNumber(pick(row, ["debit", "debitamount", "dr"]));
        const credit = toNumber(pick(row, ["credit", "creditamount", "cr"]));
        const signed = toNumber(pick(row, ["amount", "value", "netamount"]));
        let amount: number | null = null;
        let side: "debit" | "credit" | null = null;
        if (debit && debit !== 0) {
          amount = Math.abs(debit);
          side = "debit";
        } else if (credit && credit !== 0) {
          amount = Math.abs(credit);
          side = "credit";
        } else if (signed && signed !== 0) {
          amount = Math.abs(signed);
          const explicit = (pick(row, ["side", "drcr", "type"]) ?? "").toLowerCase();
          side = /deb|dr/.test(explicit)
            ? "debit"
            : /cred|cr/.test(explicit)
              ? "credit"
              : signed < 0
                ? "credit"
                : "debit";
        }
        const docNumber =
          pick(row, [
            "voucherno",
            "vouchernumber",
            "documentno",
            "documentnumber",
            "reference",
            "entryno",
            "id",
          ]) ?? `ERP-${docDate ?? periodStart}-${amount ?? 0}`;

        if (!docDate || !amount || !side) {
          skipped += 1;
          return null;
        }
        return {
          company_id: companyId,
          bank_account_id: bankAccountId,
          doc_type: pick(row, ["vouchertype", "documenttype", "doctype"]),
          doc_number: docNumber,
          party_name: pick(row, ["partyname", "party", "counterparty", "customer", "supplier"]),
          party_type: pick(row, ["partytype"]),
          amount,
          balance: toNumber(pick(row, ["balance", "runningbalance"])),
          doc_date: docDate,
          side,
          status: "open",
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

    const label = `${configRow.erp_system || "ERP"} ledger fetch ${periodStart} → ${periodEnd}`;
    const { data: userRow } = await supabase.auth.getUser();
    const email = userRow?.user?.email ?? null;

    const idempotencyKey = `${companyId}|${bankAccountId}|ledger_api|ledger|${periodStart}|${periodEnd}`;

    // Periods only block a re-fetch while their rows still exist; overlapping
    // dates are skipped so an updated feed can top up the fresh days.
    const guard = await guardIngestPeriod(supabase, {
      companyId,
      bankAccountId,
      source: "ledger",
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
      ? rows.filter((r) => !isCovered(r.doc_date, guard.covered))
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
    const dates = freshRows.map((r) => r.doc_date).filter(Boolean) as string[];
    const setStart = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : periodStart;
    const setEnd = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : periodEnd;

    const { error: dsErr } = await supabase.from("data_sets").insert({
      id: dataSetId,
      company_id: companyId,
      bank_account_id: bankAccountId,
      source: "ledger",
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
      source: "ledger",
      label,
      row_count: freshRows.length,
      created_by_email: email,
    });
    if (batchErr) throw new Error(batchErr.message);

    try {
      for (let i = 0; i < freshRows.length; i += 500) {
        const { error } = await supabase.from("accounting_records").insert(freshRows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      await supabase.from("import_batches").delete().eq("id", batchId);
      await supabase.from("data_sets").delete().eq("id", dataSetId);
      throw err;
    }

    await supabaseAdmin
      .from("erp_api_connections")
      .update({ last_fetched_at: new Date().toISOString() })
      .eq("id", configRow.id);

    return {
      inserted: freshRows.length,
      skipped,
      dataSetId,
      duplicate: false,
      rows: [] as Record<string, string>[],
    };
  });
