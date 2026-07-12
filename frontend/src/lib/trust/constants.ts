/**
 * Public trust / legal details — single source of truth for entity identity.
 * Override via env when legal entity details are finalized.
 */
export const TRUST_SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@ai-office-worker.com";

/**
 * TODO(legal): replace with the registered legal entity name (incl. ח.פ / ע.מ)
 * once provided by the owner — set NEXT_PUBLIC_COMPANY_LEGAL_NAME in the env.
 * Until then we show the public brand name only: no visible placeholder text
 * and no false legal claim (no invented registration number or address).
 */
export const TRUST_COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME?.trim() || "נטלי";

/** Service operator as published on the company details page. */
export const TRUST_OPERATOR_NAME =
  process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() || "Shay Mida";

export const TRUST_PRODUCT_NAME = "נטלי";

export const TRUST_LAST_UPDATED = "יוני 2026";

export const TRUST_COPYRIGHT_YEAR = new Date().getFullYear();
