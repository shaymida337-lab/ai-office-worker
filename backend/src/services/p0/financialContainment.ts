import { config } from "../../lib/config.js";

export const FINANCIAL_READ_CONTAINMENT_CODE = "FINANCIAL_READ_CONTAINMENT";
export const FINANCIAL_INGESTION_CONTAINMENT_CODE = "FINANCIAL_INGESTION_CONTAINMENT";
/** @deprecated Use FINANCIAL_READ_CONTAINMENT_CODE or FINANCIAL_INGESTION_CONTAINMENT_CODE */
export const FINANCIAL_DATA_CONTAINMENT_CODE = "FINANCIAL_DATA_CONTAINMENT";

const ACTIVE_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);
const INACTIVE_FLAG_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * FINANCIAL_DATA_CONTAINMENT is a legacy master kill switch.
 * When active, it overrides and blocks both financial reads and ingestion.
 */
function parseContainmentFlag(value: string | undefined, defaultWhenUnset: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultWhenUnset;
  const normalized = value.trim().toLowerCase();
  if (ACTIVE_FLAG_VALUES.has(normalized)) return true;
  if (INACTIVE_FLAG_VALUES.has(normalized)) return false;
  return true;
}

function legacyMasterFlagValue(): string | undefined {
  const raw = process.env.FINANCIAL_DATA_CONTAINMENT ?? config.security.financialDataContainment;
  return raw.trim() === "" ? undefined : raw;
}

function readContainmentFlagValue(): string | undefined {
  const raw = process.env.FINANCIAL_READ_CONTAINMENT ?? config.security.financialReadContainment;
  return raw.trim() === "" ? undefined : raw;
}

function ingestionContainmentFlagValue(): string | undefined {
  const raw = process.env.FINANCIAL_INGESTION_CONTAINMENT ?? config.security.financialIngestionContainment;
  return raw.trim() === "" ? undefined : raw;
}

function isLegacyMasterContainmentActive(): boolean {
  return parseContainmentFlag(legacyMasterFlagValue(), config.nodeEnv === "production");
}

/**
 * @deprecated Legacy master kill switch only. Prefer isFinancialReadContainmentActive /
 * isFinancialIngestionContainmentActive for split containment control.
 */
export function isFinancialDataContainmentActive(): boolean {
  return isLegacyMasterContainmentActive();
}

export function isFinancialReadContainmentActive(): boolean {
  if (isLegacyMasterContainmentActive()) return true;
  return parseContainmentFlag(readContainmentFlagValue(), true);
}

export function isFinancialIngestionContainmentActive(): boolean {
  if (isLegacyMasterContainmentActive()) return true;
  return parseContainmentFlag(ingestionContainmentFlagValue(), true);
}

export class FinancialIngestionBlockedError extends Error {
  readonly code = FINANCIAL_INGESTION_CONTAINMENT_CODE;
  readonly organizationId?: string;

  constructor(organizationId?: string) {
    super("Financial ingestion is temporarily blocked while tenant isolation is verified.");
    this.name = "FinancialIngestionBlockedError";
    this.organizationId = organizationId;
  }
}

/**
 * הקשר בעלות מאומת לפעולה בודדת: נוצר אך ורק אחרי ששורת ה-draft נטענה
 * בשאילתה של id + organizationId (מה-auth context, לא מה-body) + source.
 * זו אינה החלשה של ה-containment הכללי — רק פעולה שכולה תחומה לארגון
 * המחובר ולרשומה ספציפית שהבעלות עליה הוכחה מותרת לעבור.
 */
export type VerifiedTenantScope = {
  tenantScopeVerified: true;
  organizationId: string;
  source: "camera";
  reviewId: string;
};

export function assertFinancialIngestionAllowed(
  organizationId?: string,
  verifiedScope?: VerifiedTenantScope
): void {
  if (!isFinancialIngestionContainmentActive()) return;
  if (
    verifiedScope?.tenantScopeVerified === true &&
    verifiedScope.source === "camera" &&
    typeof verifiedScope.reviewId === "string" &&
    verifiedScope.reviewId.length > 0 &&
    typeof verifiedScope.organizationId === "string" &&
    verifiedScope.organizationId.length > 0 &&
    organizationId === verifiedScope.organizationId
  ) {
    return;
  }
  throw new FinancialIngestionBlockedError(organizationId);
}

export const FINANCIAL_DATA_PATH_PATTERNS: RegExp[] = [
  /^\/invoices(?:\/|$)/,
  /^\/payments(?:\/|$)/,
  /^\/document-reviews(?:\/|$)/,
  /^\/gmail-scan-items(?:\/|$)/,
  /^\/customer-invoices(?:\/|$)/,
  /^\/camera\/invoices(?:\/|$)/,
  /^\/reports\/(?:missing-invoices|financial)/,
  /^\/reports\/missing-invoices$/,
  /^\/accountant(?:\/|$)/,
  /^\/natalie\/invoice(?:\/|$|-)/,
  /^\/natalie\/invoice-drafts(?:\/|$)/,
  /^\/organizations\/[^/]+\/invoices(?:\/|$)/,
  /^\/help\/auto-fix\/invoices$/,
  /^\/gmail\/rescan-invoices$/,
  /^\/gmail\/scan(?:\/|$)/,
  /^\/sync\/gmail$/,
  /^\/verification(?:\/|$)/,
  /^\/analytics\/accuracy(?:\/|$)/,
  /^\/debug\/(?:invoices|payments|gmail)(?:\/|$)/,
  /^\/uploads\/(?:whatsapp-invoices|camera-invoices|gmail|invoices)(?:\/|$)/,
];

export function isFinancialDataPath(path: string): boolean {
  return FINANCIAL_DATA_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function isFinancialIngestionPath(path: string): boolean {
  return (
    /^\/gmail\/scan(?:\/|$)/.test(path) ||
    /^\/sync\/gmail$/.test(path) ||
    /^\/gmail\/rescan-invoices$/.test(path) ||
    /^\/webhook\/whatsapp/.test(path) ||
    /^\/webhooks\/whatsapp/.test(path)
  );
}
