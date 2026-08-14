import { describe, expect, it } from "vitest";
import { DEFAULT_SCORE_WEIGHTS } from "./matching";
import { computeAdaptiveWeights, type MatchDecision } from "./adaptiveWeights";

function decision(overrides: Partial<MatchDecision>): MatchDecision {
  return {
    amountScore: 50,
    referenceScore: 50,
    dateScore: 50,
    partyScore: 50,
    sideScore: 50,
    accepted: true,
    ...overrides,
  };
}

const weightsSum = (w: Record<string, number>) =>
  Object.values(w).reduce((sum, v) => sum + v, 0);

describe("computeAdaptiveWeights", () => {
  it("falls back to the base weights when there isn't enough history yet", () => {
    const result = computeAdaptiveWeights([decision({})], DEFAULT_SCORE_WEIGHTS, {
      minSampleSize: 20,
    });
    expect(result.weights).toEqual(DEFAULT_SCORE_WEIGHTS);
    expect(result.sampleSize).toBe(1);
  });

  it("always returns weights that sum to ~1", () => {
    const decisions: MatchDecision[] = Array.from({ length: 40 }, (_, i) =>
      decision({
        amountScore: i % 2 === 0 ? 90 : 20,
        referenceScore: 40,
        accepted: i % 2 === 0,
      }),
    );
    const result = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    expect(weightsSum(result.weights)).toBeCloseTo(1, 5);
  });

  it("keeps every weight within the [0.05, 0.6] guardrail", () => {
    // Extreme, one-sided history designed to try to push a weight to an extreme.
    const decisions: MatchDecision[] = Array.from({ length: 200 }, () =>
      decision({ amountScore: 100, referenceScore: 0, dateScore: 0, partyScore: 0, sideScore: 0, accepted: true }),
    );
    const result = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, {
      minSampleSize: 20,
      learningRate: 0.3,
    });
    for (const w of Object.values(result.weights)) {
      expect(w).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(w).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it("increases the weight of a sub-score that consistently predicts acceptance", () => {
    // Amount score cleanly separates accepted (high amount score) from
    // rejected (low amount score) decisions; every other sub-score is noise
    // (constant, uninformative). The learner should lean harder on amount.
    const decisions: MatchDecision[] = [];
    for (let i = 0; i < 60; i++) {
      const accepted = i % 2 === 0;
      decisions.push(
        decision({
          amountScore: accepted ? 95 : 15,
          referenceScore: 50,
          dateScore: 50,
          partyScore: 50,
          sideScore: 50,
          accepted,
        }),
      );
    }
    const result = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    expect(result.weights.amount).toBeGreaterThan(DEFAULT_SCORE_WEIGHTS.amount);
  });

  it("decreases the weight of a sub-score that is uninformative relative to others", () => {
    // Reference score is identical for accepted and rejected decisions (no
    // signal), while party score cleanly separates them. Reference's relative
    // weight should shrink.
    const decisions: MatchDecision[] = [];
    for (let i = 0; i < 60; i++) {
      const accepted = i % 2 === 0;
      decisions.push(
        decision({
          amountScore: 50,
          referenceScore: 70, // constant regardless of outcome
          dateScore: 50,
          partyScore: accepted ? 95 : 10,
          sideScore: 50,
          accepted,
        }),
      );
    }
    const result = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    expect(result.weights.reference).toBeLessThan(DEFAULT_SCORE_WEIGHTS.reference);
    expect(result.weights.party).toBeGreaterThan(DEFAULT_SCORE_WEIGHTS.party);
  });

  it("is deterministic for the same input", () => {
    const decisions: MatchDecision[] = Array.from({ length: 30 }, (_, i) =>
      decision({ amountScore: 60 + i, accepted: i % 3 !== 0 }),
    );
    const a = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    const b = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    expect(a.weights).toEqual(b.weights);
  });

  it("suggests a review threshold below the auto threshold, both within a sane range", () => {
    const decisions: MatchDecision[] = Array.from({ length: 50 }, (_, i) =>
      decision({
        amountScore: 40 + i,
        accepted: 40 + i > 65,
      }),
    );
    const result = computeAdaptiveWeights(decisions, DEFAULT_SCORE_WEIGHTS, { minSampleSize: 20 });
    expect(result.suggestedReviewThreshold).toBeLessThan(result.suggestedAutoThreshold);
    expect(result.suggestedAutoThreshold).toBeLessThanOrEqual(95);
    expect(result.suggestedReviewThreshold).toBeGreaterThanOrEqual(40);
  });

  it("does not mutate the base weights object passed in", () => {
    const base = { ...DEFAULT_SCORE_WEIGHTS };
    const decisions: MatchDecision[] = Array.from({ length: 30 }, (_, i) =>
      decision({ amountScore: 30 + i, accepted: i % 2 === 0 }),
    );
    computeAdaptiveWeights(decisions, base, { minSampleSize: 20 });
    expect(base).toEqual(DEFAULT_SCORE_WEIGHTS);
  });
});
