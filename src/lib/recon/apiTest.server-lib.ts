/** Helpers used by the connection-test server function (kept out of the fn module). */

import { assertSafeOutboundUrl } from "@/lib/recon/urlGuard.server-lib";

export function buildAuthHeaders(params: {
  authType: string;
  apiKey: string;
  apiSecret: string;
  extra: Record<string, unknown>;
}) {
  const headers = new Headers({ Accept: "application/json" });
  for (const [k, v] of Object.entries(params.extra)) {
    if (typeof v === "string") headers.set(k, v);
  }
  switch (params.authType) {
    case "basic":
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${params.apiKey}:${params.apiSecret}`).toString("base64")}`,
      );
      break;
    case "api_key":
      if (params.apiKey) headers.set("x-api-key", params.apiKey);
      break;
    case "none":
      break;
    default:
      if (params.apiKey) headers.set("Authorization", `Bearer ${params.apiKey}`);
  }
  return headers;
}

export async function probeEndpoint(params: {
  endpoint: string;
  headers: Headers;
  from: string;
  to: string;
  account: string | null;
}): Promise<{ ok: boolean; status: number | null; message: string; payload: unknown }> {
  let url: URL;
  try {
    url = new URL(params.endpoint);
  } catch {
    return { ok: false, status: null, message: "The endpoint URL is not valid.", payload: null };
  }
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);
  if (params.account) url.searchParams.set("account", params.account);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: params.headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: null,
      message:
        err instanceof Error && err.name === "AbortError"
          ? "The endpoint timed out after 20s."
          : `Could not reach the endpoint: ${err instanceof Error ? err.message : "network error"}`,
      payload: null,
    };
  }
  clearTimeout(timer);

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message:
        response.status === 401 || response.status === 403
          ? `Authentication rejected (${response.status}). Check the API key/secret and auth type.`
          : `Endpoint returned ${response.status}: ${text.slice(0, 200) || response.statusText}`,
      payload: null,
    };
  }
  try {
    return { ok: true, status: response.status, message: "OK", payload: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: response.status,
      message: "Endpoint responded, but the body was not valid JSON.",
      payload: null,
    };
  }
}
