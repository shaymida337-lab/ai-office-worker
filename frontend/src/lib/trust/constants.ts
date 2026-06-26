/**
 * Public trust / legal placeholders for production readiness.
 * Override via env when legal entity details are finalized.
 */
export const TRUST_SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@ai-office-worker.com";

/** Legal entity name — replace via NEXT_PUBLIC_COMPANY_LEGAL_NAME when confirmed */
export const TRUST_COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME?.trim() || "נטלי (שם משפטי לעדכון)";

export const TRUST_PRODUCT_NAME = "נטלי";

export const TRUST_LAST_UPDATED = "יוני 2026";

export const TRUST_COPYRIGHT_YEAR = new Date().getFullYear();
