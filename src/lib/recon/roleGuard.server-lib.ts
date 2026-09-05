import type { SupabaseClient } from "@supabase/supabase-js";

export const NOT_ADMIN_MESSAGE =
  "Only company owners and admins can configure or test integrations.";

/**
 * Server-side re-check of the caller's company role. RLS already restricts
 * writes to owners/admins, but the RPC endpoints stay directly callable, so
 * every outbound-fetch server function verifies the role itself too.
 */
export async function assertCompanyAdmin(
  supabase: SupabaseClient,
  companyId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const role = (data?.role as string | undefined) ?? "";
  if (role !== "owner" && role !== "admin") throw new Error(NOT_ADMIN_MESSAGE);
}
