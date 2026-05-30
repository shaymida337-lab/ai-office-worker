import { prisma } from "../lib/prisma.js";
import type { ParsedBankTransaction } from "./bank-parser.js";

export type BankMatchType = "suggested" | "unmatched";
export type BankMatchedRecordType = "invoice" | "supplierPayment";

export type BankMatchSuggestion = {
  transaction: ParsedBankTransaction;
  matchType: BankMatchType;
  matchedRecordId: string | null;
  matchedRecordType: BankMatchedRecordType | null;
  confidence: number;
  reason: string;
};

type Candidate = {
  id: string;
  recordType: BankMatchedRecordType;
  amount: number;
  date: Date;
  label: string | null;
};

type CandidateScore = {
  transactionIndex: number;
  candidate: Candidate;
  confidence: number;
  exactAmount: boolean;
  dayDifference: number;
  reason: string;
};

const ONE_AGORA = 0.01;
const SEARCH_WINDOW_DAYS = 30;

export async function matchTransactions(
  organizationId: string,
  transactions: ParsedBankTransaction[]
): Promise<BankMatchSuggestion[]> {
  if (transactions.length === 0) return [];

  const { from, to } = transactionDateRange(transactions, SEARCH_WINDOW_DAYS);
  const [invoices, supplierPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        date: { gte: from, lte: to },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        invoiceNumber: true,
        client: { select: { name: true } },
      },
    }),
    prisma.supplierPayment.findMany({
      where: {
        organizationId,
        date: { gte: from, lte: to },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        supplier: true,
      },
    }),
  ]);

  const invoiceCandidates: Candidate[] = invoices.map((invoice) => ({
    id: invoice.id,
    recordType: "invoice",
    amount: invoice.amount,
    date: invoice.date,
    label: invoice.invoiceNumber ?? invoice.client?.name ?? null,
  }));
  const supplierPaymentCandidates: Candidate[] = supplierPayments.map((payment) => ({
    id: payment.id,
    recordType: "supplierPayment",
    amount: payment.amount,
    date: payment.date,
    label: payment.supplier,
  }));

  const scores = transactions.flatMap((transaction, transactionIndex) => {
    const candidates = transaction.direction === "credit" ? invoiceCandidates : supplierPaymentCandidates;
    return candidates
      .map((candidate) => scoreCandidate(transaction, transactionIndex, candidate))
      .filter((score): score is CandidateScore => Boolean(score));
  });

  scores.sort((a, b) => b.confidence - a.confidence || Number(b.exactAmount) - Number(a.exactAmount) || a.dayDifference - b.dayDifference);

  const usedTransactions = new Set<number>();
  const usedRecords = new Set<string>();
  const selected = new Map<number, CandidateScore>();

  for (const score of scores) {
    const recordKey = `${score.candidate.recordType}:${score.candidate.id}`;
    if (score.confidence < 0.5) continue;
    if (usedTransactions.has(score.transactionIndex) || usedRecords.has(recordKey)) continue;

    selected.set(score.transactionIndex, score);
    usedTransactions.add(score.transactionIndex);
    usedRecords.add(recordKey);
  }

  return transactions.map((transaction, index) => {
    const match = selected.get(index);
    if (!match) {
      return {
        transaction,
        matchType: "unmatched",
        matchedRecordId: null,
        matchedRecordType: null,
        confidence: 0,
        reason: "לא נמצאה התאמה מספקת",
      };
    }

    return {
      transaction,
      matchType: "suggested",
      matchedRecordId: match.candidate.id,
      matchedRecordType: match.candidate.recordType,
      confidence: roundConfidence(match.confidence),
      reason: match.reason,
    };
  });
}

function scoreCandidate(
  transaction: ParsedBankTransaction,
  transactionIndex: number,
  candidate: Candidate
): CandidateScore | null {
  const amountDifference = Math.abs(transaction.amount - candidate.amount);
  const exactAmount = amountDifference <= ONE_AGORA;
  const amountScore = exactAmount ? 1 : amountDifference <= Math.max(candidate.amount, transaction.amount) * 0.02 ? 0.45 : 0;
  if (amountScore === 0) return null;

  const dayDifference = Math.abs(daysBetween(transaction.date, candidate.date));
  const dateScore = scoreDateProximity(dayDifference);
  const confidence = amountScore * 0.72 + dateScore * 0.28;

  return {
    transactionIndex,
    candidate,
    confidence,
    exactAmount,
    dayDifference,
    reason: buildReason(exactAmount, dayDifference, confidence),
  };
}

function scoreDateProximity(dayDifference: number) {
  if (dayDifference === 0) return 1;
  if (dayDifference <= 3) return 0.82;
  if (dayDifference <= 7) return 0.62;
  if (dayDifference <= 10) return 0.42;
  return 0.12;
}

function buildReason(exactAmount: boolean, dayDifference: number, confidence: number) {
  if (exactAmount && dayDifference === 0) return "סכום ותאריך תואמים";
  if (exactAmount) return `סכום תואם, תאריך שונה ב-${dayDifference} ימים`;
  if (confidence >= 0.5 && dayDifference === 0) return "תאריך תואם, סכום דומה";
  if (confidence >= 0.5) return `סכום דומה, תאריך שונה ב-${dayDifference} ימים`;
  return "התאמה חלשה";
}

function transactionDateRange(transactions: ParsedBankTransaction[], bufferDays: number) {
  const times = transactions.map((transaction) => transaction.date.getTime()).filter(Number.isFinite);
  const min = Math.min(...times);
  const max = Math.max(...times);
  return {
    from: addDays(new Date(min), -bufferDays),
    to: addDays(new Date(max), bufferDays),
  };
}

function daysBetween(a: Date, b: Date) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / (24 * 60 * 60 * 1000));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
