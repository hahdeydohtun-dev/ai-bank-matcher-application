/**
 * Period-overlap guard for imports (CSV upload and API fetches).
 *
 * Rules:
 *  - A previously ingested data set only blocks a re-import while its rows
 *    still exist. Once the set (or the workspace) has been cleared, the stale
 *    `data_sets` row is removed so the same period can be uploaded again.
 *  - When a new file/fetch overlaps a period that is still live, the
 *    overlapping rows are skipped and only the fresh dates are ingested.
 */

export type IngestSource = "bank" | "ledger";

export type CoveredRange = { start: string; end: string };

export type PeriodGuardResult = {
  /** Ranges that already hold live rows — new rows inside these are skipped. */
  covered: CoveredRange[];
  /** True when the whole requested period is already covered by live data. */
  fullyCovered: boolean;
  /** Number of stale (row-less) data sets that were cleaned up. */
  cleaned: number;
};

type AnyClient = {
  from: (table: string) => any;
};

const TABLE_FOR: Record<IngestSource, string> = {
  bank: "bank_transactions",
  ledger: "accounting_records",
};

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function isCovered(date: string | null | undefined, covered: CoveredRange[]) {
  if (!date) return false;
  return covered.some((r) => date >= r.start && date <= r.end);
}

export async function guardIngestPeriod(
  client: AnyClient,
  args: {
    companyId: string;
    bankAccountId: string;
    source: IngestSource;
    periodStart: string;
    periodEnd: string;
  },
): Promise<PeriodGuardResult> {
  const { companyId, bankAccountId, source, periodStart, periodEnd } = args;
  const table = TABLE_FOR[source];

  const { data: sets } = await client
    .from("data_sets")
    .select("id, period_start, period_end")
    .eq("company_id", companyId)
    .eq("bank_account_id", bankAccountId)
    .eq("source", source);

  const covered: CoveredRange[] = [];
  let cleaned = 0;

  for (const set of (sets ?? []) as {
    id: string;
    period_start: string | null;
    period_end: string | null;
  }[]) {
    const { count } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("data_set_id", set.id);

    if (!count) {
      // The rows behind this set are gone — drop the marker so the same
      // period can be re-imported.
      await client.from("data_sets").delete().eq("id", set.id);
      cleaned += 1;
      continue;
    }

    const start = set.period_start;
    const end = set.period_end ?? set.period_start;
    if (!start || !end) continue;
    if (overlaps(start, end, periodStart, periodEnd)) covered.push({ start, end });
  }

  const fullyCovered = covered.some((r) => r.start <= periodStart && r.end >= periodEnd);
  return { covered, fullyCovered, cleaned };
}
