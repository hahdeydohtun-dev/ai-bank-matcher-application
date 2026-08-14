import { db, type AccountingRecord, type BankTransaction } from "./db";
import { scoreCandidate, type ScoreWeights, type Scores, DEFAULT_SCORE_WEIGHTS } from "./matching";
import { computeAdaptiveWeights, type MatchDecision } from "./adaptiveWeights";

/**
 * Writes one row of match history: what the sub-scores were for a
 * bank-transaction/accounting-record pairing, and whether a human just
 * accepted or rejected it. This is the raw material `recalibrateMatchingWeights`
 * (below) trains on. Best-effort — a logging failure should never block the
 * reconciliation action that triggered it.
 */
export async function logMatchDecision(params: {
  companyId: string;
  txn: BankTransaction;
  record: AccountingRecord | null;
  accepted: boolean;
  source: "suggestion" | "manual";
  decidedByEmail: string | null;
  /** Pass the existing suggestion's scores when available, to avoid rescoring. */
  scores?: Scores | null;
}) {
  const { companyId, txn, record, accepted, source, decidedByEmail } = params;
  if (!companyId || !record) return; // nothing to learn from without a candidate pair

  const scores = params.scores ?? scoreCandidate(txn, record);

  try {
    await db.from("match_decisions").insert({
      company_id: companyId,
      bank_transaction_id: txn.id,
      accounting_record_id: record.id,
      amount_score: Number(scores.amount.toFixed(2)),
      reference_score: Number(scores.reference.toFixed(2)),
      date_score: Number(scores.date.toFixed(2)),
      party_score: Number(scores.party.toFixed(2)),
      side_score: Number(scores.side.toFixed(2)),
      confidence: Number(scores.confidence.toFixed(2)),
      source,
      accepted,
      decided_by_email: decidedByEmail,
    });
  } catch {
    // Logging is best-effort; never let it break the reconciliation flow.
  }
}

export type MatchingWeightsRow = {
  company_id: string;
  amount_weight: number;
  reference_weight: number;
  date_weight: number;
  party_weight: number;
  side_weight: number;
  sample_size: number;
  suggested_auto_threshold: number | null;
  suggested_review_threshold: number | null;
  recalibrated_at: string;
};

export function rowToWeights(row: MatchingWeightsRow | null): ScoreWeights {
  if (!row) return { ...DEFAULT_SCORE_WEIGHTS };
  return {
    amount: Number(row.amount_weight),
    reference: Number(row.reference_weight),
    date: Number(row.date_weight),
    party: Number(row.party_weight),
    side: Number(row.side_weight),
  };
}

/** Loads the company's current learned weights, or null if it hasn't been calibrated yet. */
export async function loadMatchingWeights(companyId: string): Promise<MatchingWeightsRow | null> {
  if (!companyId) return null;
  const { data } = await db
    .from("matching_weights")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  return (data as MatchingWeightsRow) ?? null;
}

const MIN_SAMPLE_SIZE = 20;
const HISTORY_LIMIT = 2000;

export type RecalibrateResult = {
  applied: boolean;
  sampleSize: number;
  weights: ScoreWeights;
  suggestedAutoThreshold: number;
  suggestedReviewThreshold: number;
};

/**
 * Pulls this company's accept/reject history, runs the online logistic-regression
 * update from adaptiveWeights.ts, and (if there's enough history) persists the
 * result to matching_weights. Below MIN_SAMPLE_SIZE decisions, this is a no-op
 * that reports the current sample size so the UI can show "N more needed".
 */
export async function recalibrateMatchingWeights(
  companyId: string,
  baseWeights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): Promise<RecalibrateResult> {
  const { data, error } = await db
    .from("match_decisions")
    .select("amount_score, reference_score, date_score, party_score, side_score, accepted")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);
  if (error) throw error;

  const decisions: MatchDecision[] = (data ?? []).map((d) => ({
    amountScore: Number(d.amount_score),
    referenceScore: Number(d.reference_score),
    dateScore: Number(d.date_score),
    partyScore: Number(d.party_score),
    sideScore: Number(d.side_score),
    accepted: Boolean(d.accepted),
  }));

  const result = computeAdaptiveWeights(decisions, baseWeights, {
    minSampleSize: MIN_SAMPLE_SIZE,
  });

  if (result.sampleSize < MIN_SAMPLE_SIZE) {
    return {
      applied: false,
      sampleSize: result.sampleSize,
      weights: baseWeights,
      suggestedAutoThreshold: result.suggestedAutoThreshold,
      suggestedReviewThreshold: result.suggestedReviewThreshold,
    };
  }

  const { error: upErr } = await db.from("matching_weights").upsert(
    {
      company_id: companyId,
      amount_weight: result.weights.amount,
      reference_weight: result.weights.reference,
      date_weight: result.weights.date,
      party_weight: result.weights.party,
      side_weight: result.weights.side,
      sample_size: result.sampleSize,
      suggested_auto_threshold: result.suggestedAutoThreshold,
      suggested_review_threshold: result.suggestedReviewThreshold,
      recalibrated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (upErr) throw upErr;

  return {
    applied: true,
    sampleSize: result.sampleSize,
    weights: result.weights,
    suggestedAutoThreshold: result.suggestedAutoThreshold,
    suggestedReviewThreshold: result.suggestedReviewThreshold,
  };
}
