import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from "./matching";

/**
 * One row of matching history: the sub-scores `scoreCandidate` produced for
 * a bank-transaction/accounting-record pair, and what a human ultimately did
 * with that suggestion. This is the raw material the weights are learned
 * from — see `match_decisions` table (logged from `resolve()` /
 * `mergeReconcile()` in reconciliation.tsx).
 */
export type MatchDecision = {
  amountScore: number;
  referenceScore: number;
  dateScore: number;
  partyScore: number;
  sideScore: number;
  /** true = human accepted this pairing as correct, false = rejected it */
  accepted: boolean;
};

export type AdaptiveWeightsResult = {
  weights: ScoreWeights;
  sampleSize: number;
  /** Suggested auto/review confidence thresholds recalibrated for these weights. */
  suggestedAutoThreshold: number;
  suggestedReviewThreshold: number;
};

const WEIGHT_KEYS: (keyof ScoreWeights)[] = ["amount", "reference", "date", "party", "side"];
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(weights: ScoreWeights): ScoreWeights {
  const clamped = {} as ScoreWeights;
  for (const k of WEIGHT_KEYS) clamped[k] = clamp(weights[k], MIN_WEIGHT, MAX_WEIGHT);
  const total = WEIGHT_KEYS.reduce((sum, k) => sum + clamped[k], 0);
  if (!total) return { ...DEFAULT_SCORE_WEIGHTS };
  const out = {} as ScoreWeights;
  for (const k of WEIGHT_KEYS) out[k] = clamped[k] / total;
  return out;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Online logistic-regression-style update: treat the weighted blend of
 * sub-scores (each 0..100, normalized to 0..1) as a predictor of "was this
 * match correct". Each decision nudges the weights toward whichever
 * sub-scores actually separated the good matches from the bad ones for this
 * company's data — e.g. a company whose bank narrations never carry a usable
 * reference number will see `reference` weight drift down and `party`/`date`
 * drift up, because reference stops being predictive.
 *
 * Deterministic given the same decisions in the same order, so this is
 * unit-testable without any network or randomness.
 */
export function computeAdaptiveWeights(
  decisions: MatchDecision[],
  baseWeights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
  options: { learningRate?: number; minSampleSize?: number } = {},
): AdaptiveWeightsResult {
  const learningRate = options.learningRate ?? 0.05;
  const minSampleSize = options.minSampleSize ?? 20;

  if (decisions.length < minSampleSize) {
    return {
      weights: { ...baseWeights },
      sampleSize: decisions.length,
      suggestedAutoThreshold: 85,
      suggestedReviewThreshold: 60,
    };
  }

  let weights = { ...baseWeights };

  for (const d of decisions) {
    const features: Record<keyof ScoreWeights, number> = {
      amount: d.amountScore / 100,
      reference: d.referenceScore / 100,
      date: d.dateScore / 100,
      party: d.partyScore / 100,
      side: d.sideScore / 100,
    };
    const predicted = sigmoid(
      WEIGHT_KEYS.reduce((sum, k) => sum + weights[k] * features[k], 0) * 6 - 3,
    );
    const label = d.accepted ? 1 : 0;
    const error = label - predicted; // gradient of cross-entropy wrt the linear score
    const next = { ...weights };
    for (const k of WEIGHT_KEYS) {
      next[k] = weights[k] + learningRate * error * features[k];
    }
    weights = normalize(next);
  }

  // Recalibrate thresholds against this company's own accepted-confidence
  // distribution so "auto" still means "almost always right" even after the
  // weights have shifted.
  const acceptedConfidences = decisions
    .filter((d) => d.accepted)
    .map((d) =>
      WEIGHT_KEYS.reduce(
        (sum, k) =>
          sum +
          weights[k] *
            ({ amount: d.amountScore, reference: d.referenceScore, date: d.dateScore, party: d.partyScore, side: d.sideScore }[
              k
            ] as number),
        0,
      ),
    )
    .sort((a, b) => a - b);

  const percentile = (p: number) => {
    if (!acceptedConfidences.length) return undefined;
    const idx = clamp(Math.floor(p * (acceptedConfidences.length - 1)), 0, acceptedConfidences.length - 1);
    return acceptedConfidences[idx];
  };

  const suggestedReviewThreshold = Math.round(clamp(percentile(0.1) ?? 60, 40, 80));
  const suggestedAutoThreshold = Math.round(
    clamp(percentile(0.4) ?? 85, suggestedReviewThreshold + 10, 95),
  );

  return {
    weights,
    sampleSize: decisions.length,
    suggestedAutoThreshold,
    suggestedReviewThreshold,
  };
}
