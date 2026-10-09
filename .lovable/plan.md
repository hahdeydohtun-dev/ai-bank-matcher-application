# ERP-style bank reconciliation redesign

## Scope
- Preserve TanStack routes, Lovable Cloud data, authentication, role checks, imports, matching engine, reset, bulk actions and reporting.
- Refine the reconciliation page with a reusable compact accounting header, light semantic theme, tightly grouped filters, status strip and authoritative financial summary.
- Replace the bank transaction list with a sortable, paginated table, retaining row review and adding page-scoped selection wired to existing bulk actions.
- Provide workspace tabs for bank transactions, existing ERP records, existing match board and resolution history. Preserve the full AI suggestion panel and manual consolidation workflow.

## Files
- `src/styles.css`, `src/lib/recon/settings.ts`: light default, compact semantic styling; retain selectable themes.
- `src/components/recon/ErpHeader.tsx`, `BalanceSummary.tsx`, `RecordTable.tsx`: focused presentation components using current data.
- `StatCards.tsx`, `TransactionList.tsx`, `MatchBoard.tsx`, `SuggestionsPanel.tsx`: compact existing controls and workflows.
- `src/routes/_authenticated/reconciliation.tsx`: integrate presentation while retaining existing handlers and calculations.
- Root and invite metadata: remove template titles and complete route metadata.

## Validation
- Baseline: existing 49 matching tests pass; lint currently fails with 1,462 existing findings, predominantly formatting.
- Run matching and page-selection tests, lint changed files and full lint; use automatic build/typecheck results (manual build/typecheck prohibited by workspace).
- Inspect signed-in existing account data at 1366px, 1440px and smaller widths. Exercise read-only filters, selection, tabs, import/reset dialog opening and navigation; do not execute financial mutations on production records.
- No screenshot was attached in available uploads; implement the supplied ERP visual specification.