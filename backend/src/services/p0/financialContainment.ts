import { config } from "../../lib/config.js";

export const FINANCIAL_INGESTION_CONTAINMENT_CODE = "FINANCIAL_INGESTION_CONTAINMENT";
export const FINANCIAL_DATA_CONTAINMENT_CODE = "FINANCIAL_DATA_CONTAINMENT";

export function isFinancialDataContainmentActive(): boolean {
  const flag = (process.env.FINANCIAL_DATA_CONTAINMENT ?? config.security.financialDataContainment)
    .trim()
    .toLowerCase();
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return config.nodeEnv === "production";
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

export function assertFinancialIngestionAllowed(organizationId?: string): void {
  if (isFinancialDataContainmentActive()) {
    throw new FinancialIngestionBlockedError(organizationId);
  }
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
