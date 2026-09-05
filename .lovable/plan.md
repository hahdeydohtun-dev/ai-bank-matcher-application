# Block internal addresses in bank/ERP connections

Today anyone on a company team can point a bank or ERP connection at an address that lives inside the hosting network (for example a private machine or a cloud service that hands out credentials). The server then calls it and shows the answer back in "Test connection" or "Fetch statement/ledger". This plan closes that hole.

## What changes for users

- When saving a connection with an unsafe address, they get a clear message: only public `https://` bank/ERP addresses are allowed.
- Testing or fetching with an unsafe address stops immediately with the same message instead of calling out.
- Normal, real bank/ERP addresses keep working exactly as before.

## Technical details

New shared guard module `src/lib/recon/urlGuard.server-lib.ts`:

- `assertSafeOutboundUrl(raw: string): URL` — throws a user-friendly `Error` when the URL:
  - is not parseable, or scheme is not `https:` (allow `http:` only for `localhost` in dev? No — reject outright);
  - has credentials embedded (`user:pass@`);
  - hostname is `localhost`, ends in `.local`/`.internal`, or is an IP literal in a blocked range: `127.0.0.0/8`, `0.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254`), `100.64/10`, `192.0.0/24`, `198.18/15`, multicast/reserved `224+`, and IPv6 `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped equivalents;
  - uses a non-standard port outside `443` (and `80` rejected with https-only rule).
- Because the Worker runtime cannot resolve DNS before `fetch`, the guard runs on the literal host; a DNS-rebinding note is added and mitigated by also re-validating on every fetch (not only at save).

Call sites (validate on every request, before `fetch`):

- `src/lib/recon/apiTest.server-lib.ts` → `probeEndpoint` replaces its bare `new URL()` with the guard.
- `src/lib/recon/bankApi.functions.ts` (line ~71) and `src/lib/recon/erpApi.functions.ts` (line ~71) replace their `new URL(configRow.endpoint_url)` with the guard, returning the guard's message as the existing failure result shape.
- `src/components/recon/ApiIntegrationTab.tsx` and `ErpIntegrationSection.tsx`: keep the existing client-side URL check and extend the error copy to mention https-only public addresses (the server remains the enforcement point).

After the change, mark the `ssrf_bank_erp_endpoint` finding as fixed.
