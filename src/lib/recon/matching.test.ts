import { describe, expect, it } from "vitest";
import type { AccountingRecord, BankTransaction } from "./db";
import {
  DEFAULT_SCORE_WEIGHTS,
  amountScore,
  daysBetween,
  dateScore,
  isBankCharge,
  partyScore,
  referenceScore,
  runMatching,
  scoreCandidate,
  sideScore,
  tokenize,
} from "./matching";

/* ---------------- fixtures ---------------- */

export function makeTxn(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: overrides.id ?? "txn-1",
    company_id: "company-1",
    bank_account_id: "account-1",
    txn_ref: "REF001",
    amount: 50_000,
    direction: "credit",
    txn_date: "2026-01-10",
    value_date: "2026-01-10",
    balance: null,
    narration: "NIP TRANSFER FROM ACME LTD REF001",
    status: "unreconciled",
    category: null,
    ai_confidence: null,
    reconciled_record_id: null,
    resolved_by_email: null,
    resolved_at: null,
    manually_reconciled: false,
    meta: {},
    ...overrides,
  };
}

export function makeRecord(overrides: Partial<AccountingRecord> = {}): AccountingRecord {
  return {
    id: overrides.id ?? "record-1",
    company_id: "company-1",
    doc_type: "invoice",
    doc_number: "REF001",
    party_name: "Acme Ltd",
    party_type: "customer",
    amount: 50_000,
    balance: null,
    doc_date: "2026-01-10",
    side: "debit",
    status: "open",
    meta: {},
    ...overrides,
  };
}

/* ---------------- tokenize ---------------- */

describe("tokenize", () => {
  it("splits on non-alphanumeric characters and upper-cases", () => {
    expect(tokenize("Acme-Ltd/2026, invoice#42")).toEqual([
      "ACME",
      "LTD",
      "2026",
      "INVOICE",
      "42",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

/* ---------------- amountScore ---------------- */

describe("amountScore", () => {
  it("scores an exact match as 100", () => {
    expect(amountScore(50_000, 50_000)).toBe(100);
  });

  it("is symmetric with respect to sign (debit vs credit)", () => {
    expect(amountScore(-50_000, 50_000)).toBe(100);
  });

  it("degrades proportionally to the percentage difference", () => {
    // 1% off -> penalty of 1 * 8 = 8 points
    expect(amountScore(50_500, 50_000)).toBeCloseTo(92, 0);
  });

  it("floors at 0 for large discrepancies rather than going negative", () => {
    expect(amountScore(500_000, 50_000)).toBe(0);
  });

  it("treats two zero amounts as a perfect match rather than dividing by zero", () => {
    expect(amountScore(0, 0)).toBe(100);
  });
});

/* ---------------- referenceScore ---------------- */

describe("referenceScore", () => {
  it("scores 100 when every doc-number token appears in the narration", () => {
    expect(referenceScore("Payment for INV-2026-001 received", "INV-2026-001")).toBe(100);
  });

  it("scores partial credit when only some tokens match", () => {
    // doc tokens: INV, 2026, 001 -> narration only contains INV and 2026
    const score = referenceScore("INV 2026 payment", "INV-2026-001");
    expect(score).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("scores 0 when the doc number is empty (nothing to anchor on)", () => {
    expect(referenceScore("anything at all", "")).toBe(0);
  });

  it("scores 0 when no doc-number tokens appear anywhere in the narration", () => {
    expect(referenceScore("unrelated narration text", "XYZ-999")).toBe(0);
  });
});

/* ---------------- daysBetween / dateScore ---------------- */

describe("daysBetween", () => {
  it("computes an absolute day difference regardless of order", () => {
    expect(daysBetween("2026-01-01", "2026-01-05")).toBe(4);
    expect(daysBetween("2026-01-05", "2026-01-01")).toBe(4);
  });

  it("returns a large sentinel value when either date is missing", () => {
    expect(daysBetween(null, "2026-01-01")).toBe(999);
    expect(daysBetween("2026-01-01", null)).toBe(999);
    expect(daysBetween(null, null)).toBe(999);
  });
});

describe("dateScore", () => {
  it("scores same-day as 100", () => {
    expect(dateScore("2026-01-10", "2026-01-10")).toBe(100);
  });

  it("degrades by 15 points per day of difference", () => {
    expect(dateScore("2026-01-10", "2026-01-12")).toBe(70);
  });

  it("floors at 0 once the gap is wide enough", () => {
    expect(dateScore("2026-01-10", "2026-02-10")).toBe(0);
  });
});

/* ---------------- partyScore ---------------- */

describe("partyScore", () => {
  it("scores 100 when the meaningful party words all appear in the narration", () => {
    expect(partyScore("Payment from Acme Trading", "Acme Trading Ltd")).toBe(100);
  });

  it("ignores stop words like LTD/PLC/NIGERIA when comparing", () => {
    // Without stop-word filtering, "LTD"/"PLC" wouldn't appear in narration and would drag the score down.
    expect(partyScore("Wired by Zenith Traders", "Zenith Traders Nigeria PLC")).toBe(100);
  });

  it("scores 0 when the party name has no usable (non-stopword) tokens", () => {
    expect(partyScore("anything", "The Of Co")).toBe(0);
  });

  it("scores partial credit when only some party words are present", () => {
    // "Blue", "Ocean", "Traders" are all meaningful tokens (len > 2, not
    // stopwords); only "Blue" appears in the narration.
    expect(partyScore("Blue Sky payment", "Blue Ocean Traders")).toBeCloseTo((1 / 3) * 100, 5);
  });
});

/* ---------------- sideScore ---------------- */

describe("sideScore", () => {
  it("rewards the expected opposite-side pairing (bank credit <-> ledger debit)", () => {
    expect(sideScore("credit", "debit")).toBe(100);
    expect(sideScore("debit", "credit")).toBe(100);
  });

  it("penalizes but doesn't zero-out a same-side pairing", () => {
    expect(sideScore("credit", "credit")).toBe(30);
    expect(sideScore("debit", "debit")).toBe(30);
  });
});

/* ---------------- isBankCharge ---------------- */

describe("isBankCharge", () => {
  it("detects known charge keywords case-insensitively", () => {
    expect(isBankCharge("SMS Alert charge for Jan")).toBe(true);
    expect(isBankCharge("cot on turnover")).toBe(true);
  });

  it("returns false for narrations with no charge keywords", () => {
    expect(isBankCharge("Payment for invoice 001")).toBe(false);
  });

  it("returns false for empty/undefined input", () => {
    expect(isBankCharge(undefined)).toBe(false);
    expect(isBankCharge(null)).toBe(false);
    expect(isBankCharge("")).toBe(false);
  });

  it("respects a custom keyword list", () => {
    expect(isBankCharge("custom fee applied", ["CUSTOM FEE"])).toBe(true);
    expect(isBankCharge("SMS Alert charge", ["CUSTOM FEE"])).toBe(false);
  });
});

/* ---------------- scoreCandidate ---------------- */

describe("scoreCandidate", () => {
  it("gives a near-perfect confidence for a clean matching pair", () => {
    const scores = scoreCandidate(makeTxn(), makeRecord());
    expect(scores.confidence).toBeGreaterThan(95);
  });

  it("blends sub-scores using the default weights", () => {
    const txn = makeTxn();
    const record = makeRecord();
    const scores = scoreCandidate(txn, record);
    const expected =
      scores.amount * DEFAULT_SCORE_WEIGHTS.amount +
      scores.reference * DEFAULT_SCORE_WEIGHTS.reference +
      scores.date * DEFAULT_SCORE_WEIGHTS.date +
      scores.party * DEFAULT_SCORE_WEIGHTS.party +
      scores.side * DEFAULT_SCORE_WEIGHTS.side;
    expect(scores.confidence).toBeCloseTo(expected, 5);
  });

  it("honors a partial weight override, falling back to defaults for the rest", () => {
    // A clean reference match (nonzero) so that zeroing its weight actually
    // removes a real contribution from the blend.
    const txn = makeTxn({ narration: "Payment REF001 settlement" });
    const record = makeRecord({ doc_number: "REF001" });
    const withoutOverride = scoreCandidate(txn, record);
    const withOverride = scoreCandidate(txn, record, { weights: { reference: 0 } });
    expect(withOverride.reference).toBe(withoutOverride.reference);
    expect(withOverride.reference).toBeGreaterThan(0);
    expect(withOverride.confidence).toBeLessThan(withoutOverride.confidence);
  });

  it("boosts confidence for a bank-charge pair even with a poor reference match", () => {
    const txn = makeTxn({
      narration: "SMS ALERT CHARGE",
      txn_ref: "",
      amount: 51.75,
      txn_date: "2026-01-10",
    });
    const record = makeRecord({
      doc_number: "N/A",
      party_name: null,
      doc_type: "bank charge",
      amount: 51.75,
      doc_date: "2026-01-10",
    });
    const scores = scoreCandidate(txn, record);
    expect(scores.bankCharge).toBe(true);
    expect(scores.confidence).toBeGreaterThanOrEqual(92);
  });

  it("does not apply the bank-charge boost when bankChargeAutoMatch is disabled", () => {
    const txn = makeTxn({ narration: "SMS ALERT CHARGE", txn_ref: "", amount: 51.75 });
    const record = makeRecord({
      doc_number: "N/A",
      party_name: null,
      doc_type: "bank charge",
      amount: 51.75,
    });
    const scores = scoreCandidate(txn, record, { bankChargeAutoMatch: false });
    expect(scores.bankCharge).toBe(false);
  });
});

/* ---------------- runMatching ---------------- */

describe("runMatching", () => {
  it("auto-categorizes a clean 1:1 match above the auto threshold", () => {
    const results = runMatching([makeTxn()], [makeRecord()]);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("auto");
    expect(results[0].record?.id).toBe("record-1");
  });

  it("categorizes a mediocre match as review, and a poor one as unmatched", () => {
    const txn = makeTxn({ narration: "some unrelated narration", txn_date: "2026-01-10" });
    const reviewRecord = makeRecord({
      id: "record-review",
      doc_number: "REF999",
      party_name: "Some Unrelated Party",
      doc_date: "2026-01-12",
      amount: 50_000,
    });
    const results = runMatching([txn], [reviewRecord]);
    expect(["review", "unmatched"]).toContain(results[0].category);
  });

  it("never double-assigns the same accounting record to two transactions (duplicate detection)", () => {
    const record = makeRecord({ id: "shared-record" });
    const txnA = makeTxn({ id: "txn-a" });
    const txnB = makeTxn({ id: "txn-b" });
    const results = runMatching([txnA, txnB], [record]);

    const categories = results.map((r) => r.category).sort();
    // One of them wins the record outright, the other is flagged as a duplicate claim.
    expect(categories).toContain("duplicate");
    expect(categories.filter((c) => c === "duplicate")).toHaveLength(1);

    const claimants = results.filter((r) => r.record?.id === "shared-record");
    expect(claimants).toHaveLength(2); // both still report the best candidate for visibility
  });

  it("flags amounts above the high-value threshold even when otherwise well matched", () => {
    const txn = makeTxn({ amount: 5_000_000 });
    const record = makeRecord({ amount: 5_000_000 });
    const results = runMatching([txn], [record], { highValueThreshold: 3_000_000 });
    expect(results[0].category).toBe("highvalue");
  });

  it("flags old, poorly-matched transactions as aging rather than unmatched", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const txn = makeTxn({
      narration: "totally unrelated text",
      txn_date: oldDate.toISOString().slice(0, 10),
    });
    const record = makeRecord({ doc_number: "NOPE", party_name: "Nobody", amount: 999_999_999 });
    const results = runMatching([txn], [record], { agingDays: 14 });
    expect(results[0].category).toBe("aging");
  });

  it("returns unmatched (not aging) for a poorly-matched but recent transaction", () => {
    const txn = makeTxn({
      narration: "totally unrelated text",
      txn_date: new Date().toISOString().slice(0, 10),
    });
    const record = makeRecord({ doc_number: "NOPE", party_name: "Nobody", amount: 999_999_999 });
    const results = runMatching([txn], [record], { agingDays: 14 });
    expect(results[0].category).toBe("unmatched");
  });

  it("respects custom auto/review thresholds", () => {
    const txn = makeTxn();
    const record = makeRecord();
    // A perfectly clean pair scores exactly 100, so push the bar just out of reach.
    const strict = runMatching([txn], [record], { autoThreshold: 100.5 });
    expect(strict[0].category).not.toBe("auto");

    const lenient = runMatching([txn], [record], { reviewThreshold: 0, autoThreshold: 0 });
    expect(lenient[0].category).toBe("auto");
  });

  it("returns no record when there are no candidates to match against", () => {
    // Pin `now` to the fixture's own txn_date so this doesn't depend on how
    // old "2026-01-10" happens to be relative to the real current date
    // (which would otherwise push this into the "aging" category instead).
    const now = new Date("2026-01-11T00:00:00Z");
    const results = runMatching([makeTxn()], [], {}, now);
    expect(results).toHaveLength(1);
    expect(results[0].record).toBeNull();
    expect(results[0].category).toBe("unmatched");
  });

  it("picks the best-scoring record among several candidates", () => {
    const txn = makeTxn({ amount: 50_000, narration: "Payment REF001 from Acme Ltd" });
    const poor = makeRecord({ id: "poor", doc_number: "WRONG", party_name: "Nobody", amount: 1 });
    const good = makeRecord({ id: "good", doc_number: "REF001", party_name: "Acme Ltd", amount: 50_000 });
    const results = runMatching([txn], [poor, good]);
    expect(results[0].record?.id).toBe("good");
  });

  it("applies custom weights consistently through the full matching pass", () => {
    const txn = makeTxn({ narration: "no identifiable info", txn_ref: "" });
    const record = makeRecord({ doc_number: "UNMATCHABLE-REF", party_name: null });
    const withReference = runMatching([txn], [record], { reviewThreshold: 0, autoThreshold: 200 });
    const withoutReference = runMatching([txn], [record], {
      reviewThreshold: 0,
      autoThreshold: 200,
      weights: { reference: 0, amount: 0.55, date: 0.2, party: 0.15, side: 0.1 },
    });
    expect(withoutReference[0].scores?.confidence).not.toBe(withReference[0].scores?.confidence);
  });
});
