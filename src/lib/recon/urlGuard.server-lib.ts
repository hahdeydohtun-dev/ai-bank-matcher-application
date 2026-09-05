/**
 * Outbound URL guard for user-configured bank/ERP endpoints.
 *
 * Company admins can type any address into a connection, so every server-side
 * fetch must re-validate it (not just at save time) before calling out. This
 * blocks loopback, link-local (incl. cloud metadata), and private ranges.
 */

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa"];

export const UNSAFE_URL_MESSAGE =
  "Only public https:// bank/ERP addresses are allowed. Internal or private network addresses are blocked.";

function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and friends
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIPv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return true;
  // IPv4-mapped (::ffff:169.254.169.254)
  const mapped = host.split(":").pop() ?? "";
  if (mapped.includes(".") && isBlockedIPv4(mapped)) return true;
  return false;
}

/** Throws a user-facing Error when the URL is unsafe; returns the parsed URL otherwise. */
export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The configured endpoint URL is not valid.");
  }
  if (url.protocol !== "https:") throw new Error(UNSAFE_URL_MESSAGE);
  if (url.username || url.password) throw new Error(UNSAFE_URL_MESSAGE);
  if (url.port && url.port !== "443") throw new Error(UNSAFE_URL_MESSAGE);

  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(UNSAFE_URL_MESSAGE);
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new Error(UNSAFE_URL_MESSAGE);
  if (isBlockedIPv4(host) || isBlockedIPv6(host)) throw new Error(UNSAFE_URL_MESSAGE);
  return url;
}
