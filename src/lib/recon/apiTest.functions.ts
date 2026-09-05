import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractRows } from "@/lib/recon/bankApi.parse";
import { buildAuthHeaders, probeEndpoint } from "@/lib/recon/apiTest.server-lib";
import { assertCompanyAdmin } from "@/lib/recon/roleGuard.server-lib";

export type TestConnectionInput = {
  companyId: string;
  bankAccountId: string;
  kind: "bank" | "erp";
};

export type TestConnectionResult = {
  ok: boolean;
  status: number | null;
  message: string;
  rowCount: number;
  sampleColumns: string[];
  accountCode: string | null;
  durationMs: number;
};

export const testApiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TestConnectionInput) => {
    if (!input?.companyId) throw new Error("Select a company first.");
    if (!input?.bankAccountId) throw new Error("Select a bank account first.");
    if (input.kind !== "bank" && input.kind !== "erp") throw new Error("Unknown connection kind.");
    return input;
  })
  .handler(async ({ data, context }): Promise<TestConnectionResult> => {
    const { supabase, userId } = context;
    await assertCompanyAdmin(supabase, data.companyId, userId);
    const table = data.kind === "bank" ? "bank_api_connections" : "erp_api_connections";
    const started = Date.now();

    const { data: configRow, error: configErr } = await supabase
      .from(table)
      .select("*")
      .eq("company_id", data.companyId)
      .eq("bank_account_id", data.bankAccountId)
      .maybeSingle();
    if (configErr) throw new Error(configErr.message);
    if (!configRow) throw new Error("No connection is configured for this account yet.");

    const config = configRow as unknown as Record<string, unknown>;
    const accountCode = (config.gl_account_code as string | null) ?? null;
    if (data.kind === "erp" && !accountCode) {
      return {
        ok: false,
        status: null,
        message: "No GL/cash account code is mapped to this bank account.",
        rowCount: 0,
        sampleColumns: [],
        accountCode: null,
        durationMs: Date.now() - started,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: secretRow, error: secretErr } = await supabaseAdmin
      .from(table)
      .select("api_key, api_secret, extra_headers")
      .eq("id", config.id as string)
      .maybeSingle();
    if (secretErr) throw new Error(secretErr.message);

    const headers = buildAuthHeaders({
      authType: String(config.auth_type ?? "bearer"),
      apiKey: (secretRow?.api_key as string | null) ?? "",
      apiSecret: (secretRow?.api_secret as string | null) ?? "",
      extra: (secretRow?.extra_headers ?? {}) as Record<string, unknown>,
    });

    // A short, recent window keeps the probe cheap.
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const probe = await probeEndpoint({
      endpoint: String(config.endpoint_url ?? ""),
      headers,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      account: data.kind === "erp" ? accountCode : null,
    });

    if (!probe.ok) {
      return {
        ok: false,
        status: probe.status,
        message: probe.message,
        rowCount: 0,
        sampleColumns: [],
        accountCode,
        durationMs: Date.now() - started,
      };
    }

    const rows = extractRows(probe.payload);
    const sampleColumns = rows.length ? Object.keys(rows[0] as Record<string, unknown>) : [];
    const enabledNote = config.enabled ? "" : " (connection is currently paused)";

    return {
      ok: true,
      status: probe.status,
      message: rows.length
        ? `Reached the endpoint and read ${rows.length} sample row(s) from the last 7 days.${enabledNote}`
        : `Reached the endpoint successfully, but it returned no rows for the last 7 days.${enabledNote}`,
      rowCount: rows.length,
      sampleColumns: sampleColumns.slice(0, 12),
      accountCode,
      durationMs: Date.now() - started,
    };
  });
