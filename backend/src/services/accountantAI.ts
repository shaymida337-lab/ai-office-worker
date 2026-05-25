import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

export type ExpenseCategory = {
  category: string;
  isDeductible: boolean;
  vatEligible: boolean;
  confidence: number;
};

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

export async function categorizeExpense(description: string, vendor: string, amount: number): Promise<ExpenseCategory> {
  const fallback = fallbackCategory(description, vendor);
  if (!anthropic) return fallback;
  const prompt = `Categorize this business expense for Israeli accounting. Return JSON only.
Vendor: ${vendor}
Description: ${description}
Amount: ${amount}
Categories: שיווק | ציוד משרדי | תוכנה | תקשורת | נסיעות | מקצועי | אחר
Return: {"category":"","isDeductible":true,"vatEligible":true,"confidence":0}`;
  try {
    const message = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    return normalizeCategory(JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text), fallback);
  } catch (err) {
    console.error("[accountantAI] categorization failed", err);
    return fallback;
  }
}

export async function categorizeAll(organizationId: string, period: string) {
  const { start, end } = monthRange(period);
  const expenses = await prisma.supplierPayment.findMany({ where: { organizationId, date: { gte: start, lte: end } } });
  return Promise.all(expenses.map(async (expense) => ({
    expenseId: expense.id,
    ...(await categorizeExpense(expense.subject ?? "", expense.supplier, expense.amount)),
  })));
}

function normalizeCategory(value: Record<string, unknown>, fallback: ExpenseCategory): ExpenseCategory {
  return {
    category: typeof value.category === "string" && value.category ? value.category : fallback.category,
    isDeductible: typeof value.isDeductible === "boolean" ? value.isDeductible : fallback.isDeductible,
    vatEligible: typeof value.vatEligible === "boolean" ? value.vatEligible : fallback.vatEligible,
    confidence: typeof value.confidence === "number" ? Math.max(0, Math.min(100, value.confidence)) : fallback.confidence,
  };
}

function fallbackCategory(description: string, vendor: string): ExpenseCategory {
  const text = `${vendor} ${description}`.toLowerCase();
  const category = /google|slack|notion|openai|anthropic|software|saas|תוכנה/.test(text) ? "תוכנה"
    : /facebook|meta|ads|marketing|שיווק/.test(text) ? "שיווק"
      : /phone|cell|internet|תקשורת/.test(text) ? "תקשורת"
        : /taxi|fuel|parking|נסיעות/.test(text) ? "נסיעות"
          : /office|printer|desk|ציוד/.test(text) ? "ציוד משרדי"
            : /law|account|consult|מקצוע/.test(text) ? "מקצועי"
              : "אחר";
  return { category, isDeductible: true, vatEligible: true, confidence: 60 };
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}
