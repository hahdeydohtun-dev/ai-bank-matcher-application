import type { AccountingRecord, BankTransaction, Category } from "./db";

const STOP_WORDS = new Set([
  "PLC",
  "LTD",
  "LIMITED",
  "NIGERIA",
  "NIG",
  "COMPANY",
  "CO",
  "INC",
  "ENTERPRISES",
  "AND",
  "THE",
  "OF",
]);

export const HIGH_VALUE_THRESHOLD = 3_000_000;
export const AGING_DAYS = 14;

export function tokenize(value: string): string[] {
  return value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

export function amountScore(txnAmount: number, recordAmount: number): number {
  const base = Math.abs(recordAmount) || Math.abs(txnAmount);
  if (!base) return 100;
  const diffPct = Math.abs(Math.abs(txnAmount) - Math.abs(recordAmount)) / base;
  return Math.max(0, 100 - Math.min(100, diffPct * 100 * 8));
}

export function referenceScore(narration: string, docNumber: string): number {
  const docTokens = tokenize(docNumber ?? "");
  if (!docTokens.length) return 0;
  const narrationTokens = new Set(tokenize(narration ?? ""));
  const matched = docTokens.filter((t) => narrationTokens.has(t)).length;
  return (matched / docTokens.length) * 100;
}

export function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 999;
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(diff / 86_400_000);
}

export function dateScore(txnDate: string | null, docDate: string | null): number {
  return Math.max(0, 100 - daysBetween(txnDate, docDate) * 15);
}

export function partyScore(narration: string, partyName: string): number {
  const words = tokenize(partyName ?? "").filter(
    (w) => w.length > 2 && !STOP_WORDS.has(w),
  );
  if (!words.length) return 0;
  const upperNarration = (narration ?? "").toUpperCase();
  const hits = words.filter((w) => upperNarration.includes(w)).length;
  return (hits / words.length) * 100;
}

export function sideScore(direction: string, side: string): number {
  const txnSide = direction === "credit" ? "debit" : "credit";
  return txnSide === side ? 100 : 30;
}

export const DEFAULT_CHARGE_KEYWORDS = [
  "CHARGE",
  "CHARGES",
  "COMMISSION",
  "COT",
  "VAT",
  "STAMP DUTY",
  "SMS ALERT",
  "MAINTENANCE FEE",
  "TRANSFER FEE",
  "LEVY",
  "NIP FEE",
  "BANK FEE",
];

export function isBankCharge(text: string | null | undefined, keywords = DEFAULT_CHARGE_KEYWORDS) {
  const upper = (text ?? "").toUpperCase();
  if (!upper) return false;
  return keywords.some((k) => k && upper.includes(k.toUpperCase()));
}

/**
 * Relative importance of each sub-score in the blended confidence figure.
 * Must sum to 1. Defaults match the original fixed formula; a company can
 * override these via `matching_weights` (see adaptiveWeights.ts) once it has
 * enough accept/reject history to learn from.
 */
export type ScoreWeights = {
  amount: number;
  reference: number;
  date: number;
  party: number;
  side: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  amount: 0.3,
  reference: 0.25,
  date: 0.2,
  party: 0.15,
  side: 0.1,
};

export type MatchOptions = {
  autoThreshold?: number;
  reviewThreshold?: number;
  highValueThreshold?: number;
  agingDays?: number;
  bankChargeAutoMatch?: boolean;
  chargeKeywords?: string[];
  chargeTolerance?: number;
  /** Per-company learned weights. Falls back to DEFAULT_SCORE_WEIGHTS. */
  weights?: Partial<ScoreWeights>;
};

export type Scores = {
  amount: number;
  reference: number;
  date: number;
  party: number;
  side: number;
  confidence: number;
  bankCharge?: boolean;
};

export function scoreCandidate(
  txn: BankTransaction,
  record: AccountingRecord,
  options: MatchOptions = {},
): Scores {
  const amount = amountScore(Number(txn.amount), Number(record.amount));
  const reference = referenceScore(txn.narration ?? "", record.doc_number);
  const date = dateScore(txn.txn_date, record.doc_date);
  const party = partyScore(txn.narration ?? "", record.party_name ?? "");
  const side = sideScore(txn.direction, record.side);
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...options.weights };
  let confidence =
    amount * w.amount + reference * w.reference + date * w.date + party * w.party + side * w.side;

  // Bank charges rarely carry references — pair them on keyword + amount instead.
  const keywords = options.chargeKeywords ?? DEFAULT_CHARGE_KEYWORDS;
  const tolerance = options.chargeTolerance ?? 2;
  const chargeText = `${txn.narration ?? ""} ${txn.txn_ref ?? ""}`;
  const recordText = `${record.party_name ?? ""} ${record.doc_type ?? ""} ${record.doc_number ?? ""}`;
  const bothCharges =
    (options.bankChargeAutoMatch ?? true) &&
    isBankCharge(chargeText, keywords) &&
    isBankCharge(recordText, keywords);

  let bankCharge = false;
  if (bothCharges) {
    const base = Math.abs(Number(record.amount)) || Math.abs(Number(txn.amount)) || 1;
    const diffPct =
      (Math.abs(Math.abs(Number(txn.amount)) - Math.abs(Number(record.amount))) / base) * 100;
    const closeDates = daysBetween(txn.txn_date, record.doc_date) <= 5;
    if (diffPct <= tolerance && closeDates) {
      bankCharge = true;
      confidence = Math.max(confidence, 92);
    } else if (diffPct <= tolerance * 5) {
      bankCharge = true;
      confidence = Math.max(confidence, 70);
    }
  }

  return { amount, reference, date, party, side, confidence, bankCharge };
}

export type MatchResult = {
  transaction: BankTransaction;
  record: AccountingRecord | null;
  scores: Scores | null;
  category: Category;
};

/**
 * Per-record precomputation. Tokenising every document number and party name
 * once (instead of once per transaction/record pair) is what keeps a
 * 2,000 x 2,000 match run fast.
 */
type PreparedRecord = {
  record: AccountingRecord;
  amount: number;
  dateMs: number;
  side: string;
  isCharge: boolean;
};

function prepareRecords(
  records: AccountingRecord[],
  keywords: string[],
  chargeMatching: boolean,
): PreparedRecord[] {
  return records.map((record) => ({
    record,
    amount: Math.abs(Number(record.amount)) || 0,
    dateMs: record.doc_date ? new Date(record.doc_date).getTime() : NaN,
    side: record.side,
    isCharge: chargeMatching
      ? isBankCharge(
          `${record.party_name ?? ""} ${record.doc_type ?? ""} ${record.doc_number ?? ""}`,
          keywords,
        )
      : false,
  }));
}

export function runMatching(
  transactions: BankTransaction[],
  records: AccountingRecord[],
  options: MatchOptions = {},
  now: Date = new Date(),
): MatchResult[] {
  const autoThreshold = options.autoThreshold ?? 85;
  const reviewThreshold = options.reviewThreshold ?? 60;
  const highValue = options.highValueThreshold ?? HIGH_VALUE_THRESHOLD;
  const aging = options.agingDays ?? AGING_DAYS;

  const w = { ...DEFAULT_SCORE_WEIGHTS, ...options.weights };
  const keywords = options.chargeKeywords ?? DEFAULT_CHARGE_KEYWORDS;
  const chargeMatching = options.bankChargeAutoMatch ?? true;
  const prepared = prepareRecords(records, keywords, chargeMatching);

  const best = transactions.map((txn) => {
    const txnAmount = Math.abs(Number(txn.amount)) || 0;
    const txnDateMs = txn.txn_date ? new Date(txn.txn_date).getTime() : NaN;
    const expectedSide = txn.direction === "credit" ? "debit" : "credit";
    const txnIsCharge = chargeMatching
      ? isBankCharge(`${txn.narration ?? ""} ${txn.txn_ref ?? ""}`, keywords)
      : false;

    let bestRecord: AccountingRecord | null = null;
    let bestScores: Scores | null = null;

    for (const cand of prepared) {
      // Cheap, string-free bound first: reference/party can add at most
      // their full weight, so anything that still can't beat the current
      // best is skipped before any tokenising happens.
      const base = cand.amount || txnAmount;
      const amount = base
        ? Math.max(0, 100 - Math.min(100, (Math.abs(txnAmount - cand.amount) / base) * 800))
        : 100;
      const days =
        Number.isNaN(txnDateMs) || Number.isNaN(cand.dateMs)
          ? 999
          : Math.round(Math.abs(txnDateMs - cand.dateMs) / 86_400_000);
      const date = Math.max(0, 100 - days * 15);
      const side = expectedSide === cand.side ? 100 : 30;

      let upper = amount * w.amount + 100 * w.reference + date * w.date + 100 * w.party + side * w.side;
      if (txnIsCharge && cand.isCharge) upper = Math.max(upper, 92);
      if (bestScores && upper <= bestScores.confidence) continue;

      const scores = scoreCandidate(txn, cand.record, options);
      if (!bestScores || scores.confidence > bestScores.confidence) {
        bestScores = scores;
        bestRecord = cand.record;
      }
    }
    return { transaction: txn, record: bestRecord, scores: bestScores };
  });

  best.sort((a, b) => (b.scores?.confidence ?? 0) - (a.scores?.confidence ?? 0));

  const claimed = new Set<string>();
  const results: MatchResult[] = [];

  for (const entry of best) {
    const confidence = entry.scores?.confidence ?? 0;
    const amount = Math.abs(Number(entry.transaction.amount));
    const ageDays = entry.transaction.txn_date
      ? Math.round(
          (now.getTime() - new Date(entry.transaction.txn_date).getTime()) /
            86_400_000,
        )
      : 0;

    let category: Category;
    const isDuplicate =
      !!entry.record && confidence >= reviewThreshold && claimed.has(entry.record.id);

    if (isDuplicate) {
      category = "duplicate";
    } else if (confidence < reviewThreshold && ageDays > aging) {
      category = "aging";
    } else if (amount > highValue && confidence >= reviewThreshold) {
      category = "highvalue";
    } else if (confidence >= autoThreshold) {
      category = "auto";
    } else if (confidence >= reviewThreshold) {
      category = "review";
    } else {
      category = "unmatched";
    }

    if (entry.record && confidence >= reviewThreshold && !isDuplicate) {
      claimed.add(entry.record.id);
    }

    results.push({
      transaction: entry.transaction,
      record: confidence > 0 ? entry.record : null,
      scores: entry.scores,
      category,
    });
  }

  return results;
}

