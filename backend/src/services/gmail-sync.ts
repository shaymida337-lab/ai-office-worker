import { createHash, randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { stripNulBytesDeep } from "../lib/postgresTextSanitizer.js";
import { analyzeEmailContent, analyzeInvoiceFile, type EmailAnalysis } from "./claude.js";
import { getGoogleClients, googleOAuthMetadata, isGoogleReconnectRequiredError } from "./google.js";
import { analyzeAndSaveMessage } from "./messageScanner.js";
import {
  ensureInvoiceFolderTree,
  folderForDocumentType,
  retryPendingDriveUploads,
  supplierBranchNameFromFolderName,
  uploadInvoiceAttachmentToDrive,
} from "./driveService.js";
import { appendSupplierPaymentToSheet, hasSupplierPaymentSheetRowData } from "./supplierPaymentsSheet.js";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";
import { notifyNewInvoice } from "./whatsapp.js";
import { financialDocumentBlockingReason, recordFinancialDocumentDecision } from "./financialDocuments.js";
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "./classification/junkFilter.js";
import {
  evaluateGmailDriveLinkInvoiceEvidence,
  shouldRejectPersonalEmailWithoutDocumentEvidence,
} from "./gmailDriveLinkEvidence.js";
import { initialConnectScanWindow } from "./scanWindow.js";
import {
  classifyBusinessDocument,
  pipelineActionForClassification,
  type ClassificationResult,
  type PipelineClassificationAction,
} from "./classification/classifier.js";
import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "./financialAmountLimits.js";
import { mapAnalysisDocumentTypeForAmount, moneyDecisionUncertaintySuffix, resolveGmailOrgMoneyDecision, resolvePersistedTotalAmount, summarizeMoneyDecision } from "./amount/amountCandidates.js";
import {
  attachSupplierGateToParsedFields,
  parseSupplierGateFromParsedFields,
  type SupplierGateSnapshot,
} from "./supplier/supplierGate.js";
import {
  attachAmountGateToParsedFields,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  parseAmountGateFromParsedFields,
  type AmountGateSnapshot,
} from "./amount/amountGate.js";
import {
  isCanonicalFinanceAmountResolved,
} from "./amount/financeDisplayAmount.js";
import type { MoneyDecision } from "./amount/canonicalAmount.js";
import { parseAmountOrNull, parseLabeledAmount, parseAmount } from "./amount/parseAmount.js";
import {
  buildPaymentLookupsFromCanonical,
  buildLegacyDuplicateHashForLookup,
} from "./dedup/fingerprintMigration.js";
import { computeCanonicalFingerprint, normalizeSupplierTaxId } from "./dedup/sharedMatcher.js";
import {
  attachFingerprintGateToParsedFields,
  detectScanIdentityInstability,
  parseFingerprintGateFromParsedFields,
  summarizeScfcResult,
  type FingerprintGateSnapshot,
} from "./dedup/fingerprintGate.js";
import {
  attachDuplicateGateToParsedFields,
  detectAmountRecoveredOnRescan,
  parseDuplicateGateFromParsedFields,
  type DuplicateGateSnapshot,
} from "./dedup/duplicateGate.js";
import { buildDuplicateGateInput } from "./financialDocuments.js";
import {
  createSupplierPaymentIfTrusted,
  evaluateFinanceTrustGates,
} from "./trust/financeTrustPersistence.js";
import { supplierPaymentPersistenceDecision } from "./trust/trustGatePersistence.js";
export { supplierPaymentPersistenceDecision };
import { computeFinancialSanity, summarizeFinancialSanityDecision } from "./validation/financialSanity.js";
import type { FinancialSanityContext, FinancialSanityDecision, SanityRuleId } from "./validation/sanityTypes.js";
import { computeCanonicalSupplier } from "./supplier/canonicalSupplier.js";
import {
  buildAnalysisSupplierCandidates,
  buildDocumentLabelSupplierCandidate,
  buildHistoricalSupplierCandidate,
  buildOcrKeywordSupplierCandidate,
  buildSenderSupplierCandidates,
  summarizeSupplierDecision,
} from "./supplier/supplierCandidates.js";
import type { SupplierDecision } from "./supplier/supplierTypes.js";
import { computeTrustDecision, summarizeTrustDecision } from "./trust/trustEngine.js";
import type { TrustDecision, TrustDuplicateRisk } from "./trust/trustTypes.js";
import { computeDocumentOutcome, summarizeDocumentOutcome } from "./outcome/outcomeEngine.js";
import type { DocumentOutcome, DocumentOutcomeStatus, OutcomeOptionalContext } from "./outcome/outcomeTypes.js";
import {
  checkGmailScanShouldStop,
  closeStaleGmailScansForOrg,
  createQueuedGmailScanLog,
  ensureGmailScanTerminalized,
  finalizeGmailScanFailed,
  finalizeGmailScanPaused,
  finalizeGmailScanWithDeadlineGuard,
  findActiveGmailScanLog,
  handleConcurrentGmailScanExit,
  logScanLifecycle,
  promoteGmailScanToRunning,
} from "./gmailScanLifecycle.js";

const MAX_MESSAGES_PER_SYNC = 500;
const MAX_MESSAGES_PER_RESCAN = 1_000;
const MAX_MESSAGES_PER_QUICK_SCAN = 25;
const MAX_MESSAGES_PER_FAST_SCAN = 20;
const GMAIL_SCAN_BATCH_SIZE = 10;
const GMAIL_PROGRESS_FETCH_EMAIL_INTERVAL = 25;
const GMAIL_PROGRESS_PROCESSING_EMAIL_INTERVAL = 2;
const GMAIL_PROGRESS_FETCH_MIN_INTERVAL_MS = 30_000;
const GMAIL_PROGRESS_PROCESSING_MIN_INTERVAL_MS = 2_000;

export function gmailFseSupplierCacheKey(organizationId: string, supplierName: string): string {
  return `${organizationId}|${normalizeSupplierName(supplierName).toLowerCase()}`;
}

export class GmailFinancialSanityContextSessionCache {
  private supplierHistoryByKey = new Map<string, FinancialSanityContext["supplierHistory"]>();

  getSupplierHistory(
    organizationId: string,
    supplierName: string
  ): FinancialSanityContext["supplierHistory"] | undefined {
    const key = gmailFseSupplierCacheKey(organizationId, supplierName);
    if (!this.supplierHistoryByKey.has(key)) return undefined;
    return this.supplierHistoryByKey.get(key) ?? null;
  }

  setSupplierHistory(
    organizationId: string,
    supplierName: string,
    history: FinancialSanityContext["supplierHistory"]
  ): void {
    this.supplierHistoryByKey.set(gmailFseSupplierCacheKey(organizationId, supplierName), history);
  }
}

export function shouldWriteGmailScanProgress(input: {
  force: boolean;
  emailDelta: number;
  emailInterval: number;
  elapsedMs: number;
  minIntervalMs: number;
}): boolean {
  if (input.force) return true;
  if (input.emailDelta >= input.emailInterval) return true;
  return input.elapsedMs >= input.minIntervalMs;
}

export function computeGmailScanRunningProgressPercent(emailsFetched: number, progressNumerator: number): number {
  if (emailsFetched <= 0) return 0;
  if (progressNumerator <= 0) return 5;
  return Math.min(95, Math.max(1, Math.round((progressNumerator / emailsFetched) * 100)));
}
const DRIVE_FULL_MESSAGE = "הסריקה הושלמה. לא ניתן לשמור ל-Drive - האחסון שלך מלא";
const GMAIL_EXCLUDE_QUERY = "-category:promotions -category:social -in:spam -in:trash";
import {
  buildFastScanQueries,
  FAST_SCAN_DATE_FILTER,
} from "./gmailFastScanQuery.js";
const INVOICE_KEYWORDS = [
  "חשבונית מס קבלה",
  "חשבונית",
  "חשבונית מס",
  "חשבון",
  "קבלה",
  "דרישת תשלום",
  "דרישה לתשלום",
  "בקשת תשלום",
  "תשלום קנס",
  "לתשלום",
  "invoice",
  "tax invoice",
  "receipt",
  "subscription receipt",
  "subscription invoice",
  "payment due",
  "payment request",
  "supplier bill",
  "utility bill",
  "electricity bill",
  "water bill",
  "internet bill",
  "monthly bill",
  "google payments",
  "google workspace",
  "google cloud",
  "apple receipt",
  "paypal receipt",
  "meta receipt",
  "facebook receipt",
  "openai invoice",
  "chatgpt receipt",
  "wolt invoice",
  "wolt receipt",
  "חברת חשמל",
  "חשבון חשמל",
  "חשבון מים",
  "ארנונה",
  "בזק",
  "סלקום",
  "פרטנר",
  "הוט",
  "חשבון אינטרנט",
  "פקטורה",
  "icount",
  "i-count",
  "green invoice",
  "greeninvoice",
  "חשבונית ירוקה",
  "morning",
  "meshulam",
  "משולם",
];
const STRONG_INVOICE_TERMS = [
  "חשבונית מס קבלה",
  "חשבונית מס",
  "חשבונית",
  "קבלה",
  "דרישת תשלום",
  "דרישה לתשלום",
  "תשלום קנס",
  "invoice",
  "tax invoice",
  "receipt",
  "payment request",
];
const NON_INVOICE_BLOCK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Internal IT/System", pattern: /\binternal\s+(it|system|system issue|issue report)\b/i },
  { label: "system notification", pattern: /הודעת\s+מערכת|הודעות\s+מערכת|system\s+(notification|alert|message|issue|report)|internal\s+system\s+issue\s+report/i },
  { label: "security alert", pattern: /התראת\s+אבטחה|הודעות\s+אבטחה|google\s+security|security\s+(alert|notification)|login\s+alert|new\s+sign-?in/i },
  { label: "authentication/OTP", pattern: /\botp\b|one[-\s]?time\s+password|verification\s+code|קוד\s+אימות|password\s+reset|reset\s+password|איפוס\s+סיסמה/i },
  { label: "GitHub notification", pattern: /\bgithub\b|pull\s+request|issue\s+#|dependabot|actions?\s+workflow/i },
  { label: "Render notification", pattern: /\brender\b|deploy(?:ment)?\s+(failed|succeeded|live)|service\s+is\s+live/i },
  { label: "support/test email", pattern: /\b(test|testing|support ticket|help desk|customer support|zendesk|intercom|freshdesk)\b|בדיקה|תמיכה/i },
  { label: "newsletter/marketing", pattern: /newsletter|unsubscribe|marketing|promotion|מבצע|ניוזלטר|פרסומת|עדכונים\s+שיווקיים|sale|discount/i },
];
const PERSONAL_EMAIL_CONTENT_PATTERN = /family|personal|חבר|משפחה|אישי/i;
const PERSONAL_EMAIL_DOMAIN_PATTERN = /(?:^|@)(gmail\.com|yahoo\.com|hotmail\.com|outlook\.com)$/i;
const PAYMENT_REQUEST_KEYWORDS = [
  "דרישת תשלום",
  "דרישה לתשלום",
  "בקשת תשלום",
  "תשלום קנס",
  "לתשלום",
  "נא לשלם",
  "payment request",
  "payment due",
  "please pay",
  "balance due",
  "amount due",
];
const RECEIPT_KEYWORDS = [
  "חשבונית מס קבלה",
  "קבלה",
  "receipt",
  "subscription receipt",
  "payment received",
  "paypal receipt",
  "apple receipt",
  "google receipt",
  "meta receipt",
  "openai receipt",
  "wolt receipt",
  "paid",
  "שולם",
];
const FINANCIAL_SENDER_DOMAINS = [
  "poalim.co.il",
  "bankhapoalim",
  "leumi.co.il",
  "bankleumi",
  "discountbank.co.il",
  "mizrahi-tefahot.co.il",
  "mizrahi",
  "fibi.co.il",
  "bankotsar",
  "mercantile",
  "jbank.co.il",
  "bankyahav",
  "massad",
  "pagi",
  "u-bank.net",
  "onezero",
];
const FINANCIAL_INSTITUTION_NAME_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "בנק הפועלים", pattern: /(?:^|[^\p{L}\p{N}])בנק\s+הפועלים(?=$|[^\p{L}\p{N}])/u },
  { label: "פועלים", pattern: /(?:^|[^\p{L}\p{N}])פועלים(?=$|[^\p{L}\p{N}])/u },
  { label: "בנק לאומי", pattern: /(?:^|[^\p{L}\p{N}])בנק\s+לאומי(?=$|[^\p{L}\p{N}])/u },
  { label: "לאומי", pattern: /(?:^|[^\p{L}\p{N}])לאומי(?=$|[^\p{L}\p{N}])/u },
  { label: "דיסקונט", pattern: /(?:^|[^\p{L}\p{N}])דיסקונט(?=$|[^\p{L}\p{N}])/u },
  { label: "מזרחי טפחות", pattern: /(?:^|[^\p{L}\p{N}])מזרחי(?:\s|-)+טפחות(?=$|[^\p{L}\p{N}])/u },
  { label: "מזרחי", pattern: /(?:^|[^\p{L}\p{N}])מזרחי(?=$|[^\p{L}\p{N}])/u },
  { label: "הבינלאומי", pattern: /(?:^|[^\p{L}\p{N}])(?:הבנק\s+)?הבינלאומי(?=$|[^\p{L}\p{N}])/u },
  { label: "בנק", pattern: /(?:^|[^\p{L}\p{N}])בנק(?=$|[^\p{L}\p{N}])/u },
  { label: "bank hapoalim", pattern: /\bbank\s+hapoalim\b/i },
  { label: "hapoalim", pattern: /\bhapoalim\b/i },
  { label: "poalim", pattern: /\bpoalim\b/i },
  { label: "bank leumi", pattern: /\bbank\s+leumi\b/i },
  { label: "leumi", pattern: /\bleumi\b/i },
  { label: "discount bank", pattern: /\bdiscount\s+bank\b/i },
  { label: "discount", pattern: /\bdiscount\b/i },
  { label: "mizrahi tefahot", pattern: /\bmizrahi(?:\s|-)+tefahot\b/i },
  { label: "mizrahi", pattern: /\bmizrahi\b/i },
  { label: "first international bank", pattern: /\bfirst\s+international\s+bank\b/i },
  { label: "fibi", pattern: /\bfibi\b/i },
  { label: "bank", pattern: /\bbank\b/i },
];
const MAX_AUTO_SAVE_AMOUNT = MAX_REASONABLE_FINANCIAL_AMOUNT;
const REFERENCE_NUMBER_CONTEXT =
  /(?:אסמכתא|מספר|שובר|סידורי|מסמך|חשבונית\s*(?:מס)?\s*מספר|ref|reference|invoice\s*(?:no|number)|order\s*(?:no|number)|#)/i;
const INVOICE_KEYWORD_PATTERNS = [
  /חשבונית\s*מס\s*קבלה/i,
  /חשבונית\s*מס/i,
  /חשבונית/i,
  /דריש[הת]\s+לתשלום/u,
  /תשלום\s+קנס/u,
  /tax\s+invoice/i,
  /\binvoice\b/i,
  /\breceipt\b/i,
  /subscription\s+(receipt|invoice)/i,
  /(google|apple|paypal|meta|facebook|openai|chatgpt|wolt).*(receipt|invoice|payment)/i,
  /(electricity|water|internet|utility|monthly)\s+bill/i,
  /(חשבונית|קבלה|תשלום|חשבון).*(חשמל|מים|אינטרנט|בזק|סלקום|פרטנר|הוט|ארנונה)/i,
];
const SUPPLIER_KEYWORDS = [
  "supplier",
  "vendor",
  "billing",
  "accounts",
  "finance",
  "statement",
  "quote",
  "bill",
  "tax invoice",
  "icount",
  "i-count",
  "green invoice",
  "greeninvoice",
  "חשבונית ירוקה",
  "morning",
  "meshulam",
  "ספק",
  "ספקים",
  "חשבונות",
  "גבייה",
  "תשלום",
  "הצעת מחיר",
  "חשבונית",
  "קבלה",
];
type OcrSupplierKeywordRule = {
  supplierName: string;
  confidence: number;
  patterns: RegExp[];
  contextPatterns?: RegExp[];
};

const OCR_SUPPLIER_KEYWORD_RULES: OcrSupplierKeywordRule[] = [
  {
    supplierName: "עיריית רמת גן",
    confidence: 0.99,
    patterns: [
      /עיריית\s+רמת\s+גן/u,
      /עירית\s+רמת\s+גן/u,
      /עיריה\s+רמת\s+גן/u,
      /עירייה\s+רמת\s+גן/u,
      /עירייתרמתגן/u,
      /עיריתרמתגן/u,
      /עיריהרמתגן/u,
      /עירייהרמתגן/u,
      /ramat\s+gan\s+municipality/u,
      /ramatganmunicipality/u,
    ],
  },
  {
    supplierName: "עירייה",
    confidence: 0.96,
    patterns: [
      /עיריית/u,
      /עירית/u,
      /עיריה/u,
      /עירייה/u,
      /municipality/u,
    ],
    contextPatterns: [
      /תשלום\s+קנס|דריש[הת]\s+לתשלום|קנס|גבייה|גביה|municipal|fine|collection/u,
    ],
  },
  {
    supplierName: "חברת החשמל",
    confidence: 0.99,
    patterns: [
      /חברת\s+החשמל(?:\s+לישראל)?/u,
      /חברת\s+חשמל/u,
      /חברתהחשמל(?:לישראל)?/u,
      /חברתחשמל/u,
      /israel\s+electric(?:\s+corporation)?/u,
      /israelelectric(?:corporation)?/u,
      /electric\s+corporation/u,
      /electriccorporation/u,
    ],
  },
  {
    supplierName: "מי רמת גן",
    confidence: 0.99,
    patterns: [
      /מי\s+רמת\s+גן/u,
      /תאגיד\s+מי\s+רמת\s+גן/u,
      /מירמתגן/u,
      /תאגידמירמתגן/u,
      /mei\s+ramat\s+gan/u,
      /meiramatgan/u,
    ],
  },
  {
    supplierName: "ארנונה",
    confidence: 0.97,
    patterns: [
      /ארנונה/u,
      /חיוב\s+ארנונה/u,
      /תשלום\s+ארנונה/u,
      /arnona/u,
      /municipal\s+tax/u,
      /property\s+tax/u,
    ],
  },
  {
    supplierName: "בזק",
    confidence: 0.99,
    patterns: [
      /בזק/u,
      /bezeq/u,
      /bezeqint/u,
      /bezeq\s+international/u,
      /בזק\s+בינלאומי/u,
      /בזקבינלאומי/u,
    ],
  },
  {
    supplierName: "הוט",
    confidence: 0.98,
    patterns: [
      /(?:^|\s)הוט(?:\s|$)/u,
      /(?:^|\s)hot(?:\s|$)/u,
      /hotmobile/u,
      /hot\s+mobile/u,
      /הוטמובייל/u,
      /הוט\s+מובייל/u,
    ],
    contextPatterns: [
      /חשבונית|חשבון|קבלה|תשלום|חיוב|אינטרנט|תקשורת|כבלים|סלולר|mobile|internet|invoice|bill|payment|statement/u,
    ],
  },
  {
    supplierName: "סלקום",
    confidence: 0.99,
    patterns: [
      /סלקום/u,
      /cellcom/u,
    ],
  },
  {
    supplierName: "פלאפון",
    confidence: 0.99,
    patterns: [
      /פלאפון/u,
      /pelephone/u,
    ],
  },
  {
    supplierName: "yes",
    confidence: 0.98,
    patterns: [
      /(?:^|\s)yes(?:\s|$)/u,
      /(?:^|\s)יס(?:\s|$)/u,
    ],
    contextPatterns: [
      /חשבונית|חשבון|קבלה|תשלום|חיוב|טלוויזיה|טלויזיה|תקשורת|לוויין|לווין|tv|television|invoice|bill|payment|statement/u,
    ],
  },
  {
    supplierName: "max",
    confidence: 0.98,
    patterns: [
      /(?:^|\s)max(?:\s|$)/u,
      /(?:^|\s)מקס(?:\s|$)/u,
      /לאומי\s+קארד/u,
      /לאומיקארד/u,
    ],
    contextPatterns: [
      /חשבונית|חשבון|קבלה|תשלום|חיוב|כרטיס|אשראי|פירוט|עסקה|ויזה|מאסטרקארד|credit|card|statement|invoice|payment|transaction/u,
    ],
  },
  {
    supplierName: "ישראכרט",
    confidence: 0.99,
    patterns: [
      /ישראכרט/u,
      /ישרא\s+כרט/u,
      /isracard/u,
      /isra\s+card/u,
    ],
  },
  {
    supplierName: "פז",
    confidence: 0.98,
    patterns: [
      /(?:^|\s)פז(?:\s|$)/u,
      /(?:^|\s)paz(?:\s|$)/u,
      /yellow/u,
    ],
    contextPatterns: [
      /חשבונית|חשבון|קבלה|תשלום|חיוב|דלק|תחנה|תדלוק|fuel|gas|station|invoice|receipt|payment|yellow/u,
    ],
  },
  {
    supplierName: "דור אלון",
    confidence: 0.99,
    patterns: [
      /דור\s+אלון/u,
      /דוראלון/u,
      /dor\s+alon/u,
      /doralon/u,
    ],
  },
  {
    supplierName: "הולילנד",
    confidence: 0.99,
    patterns: [
      /הולילנד/u,
      /holyland/u,
    ],
  },
  {
    supplierName: "סופר פארם",
    confidence: 0.99,
    patterns: [
      /סופר\s+פארם/u,
      /סופרפארם/u,
      /super\s+pharm/u,
      /superpharm/u,
    ],
  },
  {
    supplierName: "Wolt",
    confidence: 0.99,
    patterns: [
      /וולט/u,
      /wolt/u,
    ],
  },
];
const REVIEWABLE_DOCUMENT_TYPES = new Set<GmailDocumentType>([
  "invoice",
  "receipt",
  "tax_invoice_receipt",
  "payment_request",
  "quote",
  "supplier_message",
  "unknown_needs_review",
]);

export async function quickScanGmailForOrganization(organizationId: string, options: { daysBack?: number } = {}) {
  const daysBack = options.daysBack ?? 7;
  const { gmail } = await getGoogleClients(organizationId);
  const listing = await withTimeout(
    listCandidateMessages(gmail, daysBack, MAX_MESSAGES_PER_QUICK_SCAN),
    8_000,
    "Gmail quick scan timed out"
  );
  const messages = listing.messages;

  await prisma.syncLog.create({
    data: {
      organizationId,
      type: "gmail_scan",
      status: "success",
      emailsProcessed: messages.length,
      finishedAt: new Date(),
    },
  });

  return {
    emailsProcessed: messages.length,
    emailsFound: messages.length,
    paymentsCreated: 0,
    tasksCreated: 0,
    clientsCreated: 0,
    invoicesCreated: 0,
    duplicatesSkipped: 0,
    recordsSaved: 0,
    uniqueSenders: 0,
    potentialClients: 0,
    invoiceEmails: 0,
    invoiceAmountsExtracted: 0,
    quick: true,
    backgroundProcessing: true,
    scanSteps: [`נמצאו ${messages.length} מיילים ב-Gmail`, "העיבוד המלא ממשיך ברקע"],
  };
}

let gmailScanQueue: Promise<unknown> = Promise.resolve();

type GmailSyncOptions = {
  daysBack?: number;
  since?: Date;
  isFirstTime?: boolean;
  forceReprocess?: boolean;
  scanAllMail?: boolean;
  maxMessages?: number;
  scanLogId?: string;
  scanMode?: "manual" | "manual_incremental" | "auto_daily" | "auto_weekly" | "retry" | "first_time" | "fast_recurring";
  retryOfId?: string;
  fastOnly?: boolean;
};

export async function syncGmailForOrganization(organizationId: string, options: GmailSyncOptions = {}) {
  const scanLogId = options.scanLogId;
  const queuedRun = gmailScanQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        return await runGmailSyncForOrganization(organizationId, options);
      } catch (err) {
        if (scanLogId) {
          const message = err instanceof Error ? err.message : String(err);
          await finalizeGmailScanFailed(scanLogId, message);
          logScanLifecycle(scanLogId, "failed", `reason=${message}`);
        }
        throw err;
      }
    });
  gmailScanQueue = queuedRun.catch(() => undefined);
  return queuedRun;
}

async function runGmailSyncForOrganization(organizationId: string, options: GmailSyncOptions = {}) {
  const { assertGmailIntegrationIsolatedForScan } = await import("./gmailIntegrationIsolation.js");
  await assertGmailIntegrationIsolatedForScan(organizationId);

  await closeStaleGmailScansForOrg(organizationId, options.scanLogId);

  const returnInProgress = async (activeScanId: string) => {
    if (options.scanLogId) {
      await handleConcurrentGmailScanExit({
        organizationId,
        scanLogId: options.scanLogId,
        activeScanId,
      });
    }
    console.log(`[gmail-sync] Existing Gmail scan still active org=${organizationId} log=${activeScanId}`);
    return {
      emailsProcessed: 0,
      paymentsCreated: 0,
      tasksCreated: 0,
      clientsCreated: 0,
      invoicesCreated: 0,
      uniqueSenders: 0,
      potentialClients: 0,
      invoiceEmails: 0,
      invoiceAmountsExtracted: 0,
      relevantEmailsFound: 0,
      recordsSaved: 0,
      duplicatesSkipped: 0,
      errorsCount: 0,
      emailsSavedToGmailScanItem: 0,
      emailsParsed: 0,
      driveUploadsSucceeded: 0,
      parserRejectedCount: 0,
      ignoredCount: 0,
      ignoredReasons: {} as Record<string, number>,
      sheetsUpdated: 0,
      inProgress: true as const,
      scanLogId: activeScanId,
      scanSteps: ["סריקת Gmail כבר רצה"],
    };
  };

  const activeLog = await findActiveGmailScanLog(organizationId, options.scanLogId);
  if (activeLog) {
    return returnInProgress(activeLog.id);
  }

  let log: { id: string } | null = null;

  const scanSteps: string[] = [];
  const logStep = (message: string) => {
    scanSteps.push(message);
    console.log(message);
  };

  try {
    const retryResult = await retryPendingDriveUploads(organizationId);
    if (retryResult.attempted > 0) {
      logStep(`[gmail-sync] Drive pending retry attempted=${retryResult.attempted} uploaded=${retryResult.uploaded} failed=${retryResult.failed}`);
    }
  } catch (err) {
    console.error(`[gmail-sync] pending Drive retry failed org=${organizationId}`, err);
    logStep(`[gmail-sync] pending Drive retry skipped reason="${err instanceof Error ? err.message : String(err)}"`);
  }

  const initialWindow = options.isFirstTime && !options.since && !options.daysBack ? initialConnectScanWindow() : null;
  const daysBack = initialWindow?.daysBack ?? options.daysBack ?? 90;
  const since = options.since ?? initialWindow?.since;
  const scanMode = options.scanMode ?? (options.isFirstTime ? "first_time" : "manual");
  if (options.forceReprocess) {
    logStep(`[gmail-sync] Force reprocess enabled for ${daysBack} day scan`);
  }
  if (since) {
    logStep(`[gmail-sync] Incremental scan since ${since.toISOString()}`);
  }
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { user: { select: { email: true } }, businessName: true, businessId: true },
  });
  const ownerEmails = new Set([organization?.user.email].filter((email): email is string => Boolean(email)).map((email) => email.toLowerCase()));
  const knownSupplierNames = await loadKnownSupplierNames(organizationId);

  const activeLogAfterReset = await findActiveGmailScanLog(organizationId, options.scanLogId);
  if (activeLogAfterReset) {
    return returnInProgress(activeLogAfterReset.id);
  }

  const existingScanLog = options.scanLogId
    ? await prisma.syncLog.findFirst({
        where: { id: options.scanLogId, organizationId, type: "gmail_scan" },
      })
    : null;
  if (existingScanLog) {
    log = existingScanLog;
  } else if (options.scanLogId) {
    throw new Error(`Gmail scan log not found: ${options.scanLogId}`);
  } else {
    const created = await createQueuedGmailScanLog(organizationId, scanMode, options.retryOfId);
    log = created.scanLog;
  }

  await promoteGmailScanToRunning(log.id);
  logScanLifecycle(log.id, "fetch start");

  const scanStartedAt =
    existingScanLog?.startedAt ??
    (
      await prisma.syncLog.findFirst({
        where: { id: log.id },
        select: { startedAt: true },
      })
    )?.startedAt ??
    new Date();
  let deadlineTruncated = false;
  let externalTerminalStop = false;
  let plannedTotalMatched: number | undefined;
  const shouldStopScan = async () => {
    const result = await checkGmailScanShouldStop(log.id, scanStartedAt);
    if (result.stop && result.reason === "deadline") deadlineTruncated = true;
    if (result.stop && result.reason === "external_terminal") externalTerminalStop = true;
    return result.stop;
  };
  const buildEarlyExitResult = () => ({
    emailsProcessed,
    paymentsCreated,
    tasksCreated,
    clientsCreated,
    invoicesCreated,
    uniqueSenders,
    potentialClients,
    invoiceEmails,
    invoiceAmountsExtracted,
    relevantEmailsFound: relevantEmailsFound,
    recordsSaved: paymentsCreated + invoicesCreated + tasksCreated + clientsCreated,
    duplicatesSkipped,
    errorsCount,
    emailsSavedToGmailScanItem,
    emailsParsed,
    driveUploadsAttempted,
    driveUploadsSucceeded,
    driveUploadsSkipped,
    driveUploadsFailed,
    sheetsUpdated,
    parserRejectedCount,
    ignoredCount,
    ignoredReasons,
    scanSteps,
    inProgress: false as const,
    scanLogId: log!.id,
  });

  if (existingScanLog) {
    await prisma.syncLog.update({
      where: { id: existingScanLog.id },
      data: { errorMessage: null, finishedAt: null, scanMode, retryOfId: options.retryOfId },
    });
  }

  let emailsProcessed = 0;
  let paymentsCreated = 0;
  let tasksCreated = 0;
  let driveUploadFailed = false;
  let clientsCreated = 0;
  let invoicesCreated = 0;
  let invoiceEmails = 0;
  let invoiceAmountsExtracted = 0;
  let uniqueSenders = 0;
  let potentialClients = 0;
  let duplicatesSkipped = 0;
  let relevantEmailsFound = 0;
  let receiptsFound = 0;
  let paymentRequestsFound = 0;
  let supplierMessagesFound = 0;
  let needsReviewCount = 0;
  let errorsCount = 0;
  let emailsSavedToGmailScanItem = 0;
  let emailsParsed = 0;
  let parserRejectedCount = 0;
  let dbEmailMessageUpserts = 0;
  let dbGmailScanItemUpserts = 0;
  let driveUploadsAttempted = 0;
  let driveUploadsSucceeded = 0;
  let driveUploadsSkipped = 0;
  let driveUploadsFailed = 0;
  let sheetsUpdated = 0;
  let lastProgressWriteAt = 0;
  let lastProgressEmailsProcessed = 0;
  let lastProgressEmailsAnalyzed = 0;
  let emailsAnalyzedInProcessing = 0;
  let scanProgressPhase: "fetch" | "process" = "fetch";
  let invoiceDetectionPositive = 0;
  let invoiceDetectionNegative = 0;
  let ignoredCount = 0;
  const ignoredReasons: Record<string, number> = {};
  const fseContextCache = new GmailFinancialSanityContextSessionCache();
  const maybeSaveScanProgress = async (force = false) => {
    const now = Date.now();
    const isProcessingPhase = scanProgressPhase === "process";
    const emailDelta = isProcessingPhase
      ? emailsAnalyzedInProcessing - lastProgressEmailsAnalyzed
      : emailsProcessed - lastProgressEmailsProcessed;
    const emailInterval = isProcessingPhase
      ? GMAIL_PROGRESS_PROCESSING_EMAIL_INTERVAL
      : GMAIL_PROGRESS_FETCH_EMAIL_INTERVAL;
    const minIntervalMs = isProcessingPhase
      ? GMAIL_PROGRESS_PROCESSING_MIN_INTERVAL_MS
      : GMAIL_PROGRESS_FETCH_MIN_INTERVAL_MS;
    if (
      !shouldWriteGmailScanProgress({
        force,
        emailDelta,
        emailInterval,
        elapsedMs: now - lastProgressWriteAt,
        minIntervalMs,
      })
    ) {
      return;
    }
    const progressEmailsSaved = isProcessingPhase
      ? Math.max(emailsSavedToGmailScanItem, emailsAnalyzedInProcessing)
      : emailsSavedToGmailScanItem;
    await saveScanProgress(log.id, {
      emailsProcessed,
      emailsSaved: progressEmailsSaved,
      invoicesFound: invoicesCreated + needsReviewCount,
      paymentsCreated,
      tasksCreated,
      driveUploaded: driveUploadsSucceeded,
      sheetsUpdated,
      errorsCount,
    });
    lastProgressWriteAt = now;
    if (isProcessingPhase) {
      lastProgressEmailsAnalyzed = emailsAnalyzedInProcessing;
    } else {
      lastProgressEmailsProcessed = emailsProcessed;
    }
  };

  const ignoreMessage = (reason: string, messageId?: string | null) => {
    ignoredCount++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] ignored message=${messageId ?? "unknown"} reason="${reason}"`);
  };

  const saveRejectedScanItem = async (email: ScannedEmail, reason: string) => {
    const attachmentFilename = primaryAttachmentFilename(email.parts);
    const supplierName = normalizeSupplierName(email.senderName || email.domain || "Unknown supplier");
    const duplicateKey = buildGmailScanDuplicateKey({
      gmailMessageId: email.gmailId,
      attachmentFilename,
      supplierName,
      amount: null,
    });
    logStep(`[gmail-sync] DB fallback GmailScanItem upsert attempt message=${email.gmailId} reason="${reason}"`);
    const saved = await prisma.gmailScanItem.upsert({
      where: { organizationId_duplicateKey: { organizationId, duplicateKey } },
      create: {
        organizationId,
        emailMessageId: email.emailRecordId,
        gmailMessageId: email.gmailId,
        gmailMessageLink: gmailMessageLink(email.gmailId),
        sender: email.from || "unknown",
        senderEmail: email.senderEmail || null,
        subject: email.subject,
        occurredAt: email.receivedAt,
        amount: null,
        supplierName,
        documentType: "unknown_needs_review",
        attachmentFilename,
        driveFileLink: null,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        duplicateKey,
        decisionReason: reason,
        rawAnalysis: {
          parserRejected: true,
          reason,
          bodyLength: email.bodyText.length,
          hasAttachment: email.parts.length > 0,
          filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
        },
      },
      update: {
        emailMessageId: email.emailRecordId,
        gmailMessageLink: gmailMessageLink(email.gmailId),
        sender: email.from || "unknown",
        senderEmail: email.senderEmail || null,
        subject: email.subject,
        occurredAt: email.receivedAt,
        amount: null,
        supplierName,
        documentType: "unknown_needs_review",
        attachmentFilename,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        decisionReason: reason,
        rawAnalysis: {
          parserRejected: true,
          reason,
          bodyLength: email.bodyText.length,
          hasAttachment: email.parts.length > 0,
          filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
        },
      },
    });
    emailsSavedToGmailScanItem++;
    dbGmailScanItemUpserts++;
    parserRejectedCount++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] DB fallback GmailScanItem upsert success message=${email.gmailId} id=${saved.id} reason="${reason}"`);
    return saved;
  };

  const saveFetchErrorScanItem = async (orgId: string, gmailMessageId: string, reason: string) => {
    const duplicateKey = createHash("sha256")
      .update(`${gmailMessageId}|fetch-error`)
      .digest("hex")
      .slice(0, 40);
    const saved = await prisma.gmailScanItem.upsert({
      where: { organizationId_duplicateKey: { organizationId: orgId, duplicateKey } },
      create: {
        organizationId: orgId,
        gmailMessageId,
        gmailMessageLink: gmailMessageLink(gmailMessageId),
        sender: "unknown",
        senderEmail: null,
        subject: "(fetch failed)",
        occurredAt: new Date(),
        amount: null,
        supplierName: "Unknown supplier",
        documentType: "unknown_needs_review",
        attachmentFilename: null,
        driveFileLink: null,
        confidenceScore: "low",
        reviewStatus: "needs_review",
        duplicateKey,
        decisionReason: reason,
        rawAnalysis: { parserRejected: true, reason, stage: "fetch_parse_save" },
      },
      update: {
        decisionReason: reason,
        reviewStatus: "needs_review",
        rawAnalysis: { parserRejected: true, reason, stage: "fetch_parse_save" },
      },
    });
    emailsSavedToGmailScanItem++;
    dbGmailScanItemUpserts++;
    ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1;
    logStep(`[gmail-sync] DB fetch-error GmailScanItem upsert success message=${gmailMessageId} id=${saved.id}`);
  };

  try {
    logStep("[gmail-sync] Checking Gmail token and creating Google clients");
    const { gmail, drive, oauth2 } = await getGoogleClients(organizationId);
    const { assertGmailConnectedAccountNotShared, GmailIntegrationIsolationError } = await import(
      "./gmailIntegrationIsolation.js"
    );
    try {
      const google = await import("googleapis").then((module) => module.google);
      const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
      const profile = await oauth2api.userinfo.get();
      const mailboxEmail = profile.data.email;
      if (mailboxEmail) {
        await assertGmailConnectedAccountNotShared(organizationId, mailboxEmail);
        const integration = await prisma.integration.findUnique({
          where: { organizationId_provider: { organizationId, provider: "gmail" } },
          select: { metadata: true },
        });
        const metadata = googleOAuthMetadata(integration?.metadata, null, mailboxEmail);
        if (integration && metadata !== integration.metadata) {
          await prisma.integration.update({
            where: { organizationId_provider: { organizationId, provider: "gmail" } },
            data: { metadata },
          });
        }
        logStep(`[gmail-sync] Gmail mailbox isolation verified mailbox=${mailboxEmail}`);
      }
    } catch (err) {
      if (err instanceof GmailIntegrationIsolationError) {
        throw err;
      }
      console.error(`[gmail-sync] Gmail mailbox isolation check failed org=${organizationId}`, err);
      throw err;
    }
    let rootId: string | null = null;
    try {
      logStep("[gmail-sync] Checking Drive invoice folder");
      rootId = await ensureInvoiceFolderTree(drive);
    } catch (err) {
      driveUploadFailed = true;
      console.error("Drive setup failed; continuing Gmail sync without Drive", err);
      if (isGoogleReconnectRequiredError(err) || isInsufficientScopeError(err)) {
        logStep(`[gmail-sync] Google Drive reconnect required org=${organizationId} reason="${err instanceof Error ? err.message : String(err)}"`);
      }
    }
    const scannedEmails: ScannedEmail[] = [];

    const fetchAndParseMessages = async (
      messagesToFetch: GmailMessageRef[],
      label: "fast" | "historical"
    ) => {
      let fetchBatchNumber = 0;
      const totalBatches = Math.ceil(messagesToFetch.length / GMAIL_SCAN_BATCH_SIZE);
      let stopFetching = false;
      for (const batch of chunkArray(messagesToFetch, GMAIL_SCAN_BATCH_SIZE)) {
        if (await shouldStopScan()) {
          deadlineTruncated = true;
          break;
        }
        fetchBatchNumber++;
        logStep(`[gmail-sync] fetch ${label} batch ${fetchBatchNumber}/${totalBatches} size=${batch.length}`);
      for (const msgRef of batch) {
        if (stopFetching) break;
        if (await shouldStopScan()) {
          deadlineTruncated = true;
          stopFetching = true;
          break;
        }
        if (!msgRef.id) {
          ignoreMessage("missing_gmail_message_id", msgRef.id);
          continue;
        }
        if (label === "fast") {
          logStep(`[gmail-sync] FAST_SCAN_PROCESSING_MESSAGE message=${msgRef.id}`);
        }

        try {
        const existing = await prisma.emailMessage.findUnique({
          where: {
            organizationId_gmailId: {
              organizationId,
              gmailId: msgRef.id,
            },
          },
        });
        const full = await withRetry(
          () => gmail.users.messages.get({
            userId: "me",
            id: msgRef.id!,
            format: "full",
          }),
          `[gmail-sync] Gmail message fetch retry message=${msgRef.id}`
        );

      const headers = full.data.payload?.headers ?? [];
      const subject = decodeMimeHeader(
        headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(ללא נושא)"
      );
      const from =
        decodeMimeHeader(headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "");
      const dateHeader =
        headers.find((h) => h.name?.toLowerCase() === "date")?.value ?? "";
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
      const bodyText = extractBody(full.data.payload as PayloadPart | undefined);
      const sender = parseSender(from);
      const source = /whatsapp|וואטסאפ/i.test(subject + from)
        ? "whatsapp_forward"
        : "gmail";

      const attachmentParts = collectAttachmentParts(full.data.payload as PayloadPart | undefined);
      for (const imagePart of attachmentParts.filter(isInvoiceImageAttachmentPart)) {
        logStep(`[gmail-sync] IMAGE_ATTACHMENT_FOUND message=${msgRef.id} file="${attachmentFilenameForPart(imagePart)}" mime=${imageMimeTypeForPart(imagePart) ?? imagePart.mimeType ?? "unknown"} inline=${isInlineAttachmentPart(imagePart)}`);
      }
      logStep(`[gmail-sync] fetched message=${msgRef.id} sender="${from || "unknown"}" subject="${subject}" date="${receivedAt.toISOString()}" attachments=${attachmentParts.length ? attachmentParts.map((part) => `${part.filename || "unnamed"}:${part.mimeType || "unknown"}`).join(", ") : "none"} bodyLength=${bodyText.length}`);
      emailsParsed++;
      if (!bodyText.trim() && attachmentParts.length === 0) {
        parserRejectedCount++;
        ignoredReasons.empty_body_and_no_attachments = (ignoredReasons.empty_body_and_no_attachments ?? 0) + 1;
        logStep(`[gmail-sync] parser decision message=${msgRef.id} rejected=true reason="empty_body_and_no_attachments"`);
      } else {
        logStep(`[gmail-sync] parser decision message=${msgRef.id} rejected=false reason="body_or_attachment_present"`);
      }

        const emailRecord = await prisma.emailMessage.upsert({
          where: {
            organizationId_gmailId: { organizationId, gmailId: msgRef.id },
          },
          create: {
            organizationId,
            gmailId: msgRef.id,
            threadId: full.data.threadId ?? undefined,
            subject,
            fromAddress: from,
            snippet: full.data.snippet ?? undefined,
            bodyText,
            receivedAt,
            source,
          },
          update: {
            bodyText,
            snippet: full.data.snippet ?? undefined,
            fromAddress: from,
            receivedAt,
          },
        });
        logStep(`[gmail-sync] DB upsert EmailMessage success message=${msgRef.id} id=${emailRecord.id}`);
        dbEmailMessageUpserts++;
        await persistAttachmentMetadata(emailRecord.id, attachmentParts);

      await analyzeAndSaveMessage({
        organizationId,
        channel: "gmail",
        externalId: msgRef.id,
        emailMessageId: emailRecord.id,
        from,
        senderName: sender.name,
        senderEmail: sender.email ?? "",
        senderPhone: extractPhoneFromText(bodyText),
        subject,
        bodyText,
        occurredAt: receivedAt,
        createLead: true,
      }).catch((err) => {
        console.warn("[gmail-sync] message intelligence scan failed", err instanceof Error ? err.message : String(err));
      });

        scannedEmails.push({
          gmailId: msgRef.id,
          emailRecordId: emailRecord.id,
          subject,
          from,
          senderEmail: sender.email,
          senderName: sender.name,
          domain: sender.domain ?? "",
          bodyText,
          receivedAt,
          source,
          parts: attachmentParts,
          fullPayload: full.data.payload as PayloadPart | undefined,
          alreadyProcessed: Boolean(existing?.processedAt),
        });
        emailsProcessed++;
        } catch (err) {
          errorsCount++;
          console.error(`[gmail-sync] fetch/parse/save failed message=${msgRef.id}`, err);
          logStep(`[gmail-sync] error message=${msgRef.id} stage=fetch_parse_save reason="${err instanceof Error ? err.message : String(err)}"`);
          try {
            await saveFetchErrorScanItem(organizationId, msgRef.id, `fetch_parse_save_failed: ${err instanceof Error ? err.message : String(err)}`);
          } catch (fallbackErr) {
            console.error(`[gmail-sync] fetch-error GmailScanItem save failed message=${msgRef.id}`, fallbackErr);
            logStep(`[gmail-sync] error message=${msgRef.id} stage=fetch_error_scan_item_save reason="${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}"`);
          }
        }
      }
        await maybeSaveScanProgress();
        if (stopFetching) break;
      }
    };

    const fastScanMaxMessages = options.maxMessages ?? MAX_MESSAGES_PER_FAST_SCAN;
    logStep(`[gmail-sync] FAST_SCAN_STARTED query=${FAST_SCAN_DATE_FILTER} maxResults=${fastScanMaxMessages} mode=${scanMode}`);
    const fastListing = await listFastCandidateMessages(gmail, fastScanMaxMessages, {
      scanAllMail: options.scanAllMail,
    });
    const fastMessages = fastListing.messages;
    const fastMessageIds = new Set(fastMessages.flatMap((message) => message.id ? [message.id] : []));
    logStep(`[gmail-sync] FAST_SCAN_FOUND_MESSAGES count=${fastMessages.length} diagnostics=${JSON.stringify(fastListing.diagnostics)}`);
    await fetchAndParseMessages(fastMessages, "fast");
    const fastScannedEmails = scannedEmails.splice(0, scannedEmails.length);
    logScanLifecycle(log.id, "fetch end");
    logScanLifecycle(log.id, "processing start");
    await processScannedEmails(fastScannedEmails, "fast");
    logStep(`[gmail-sync] FAST_SCAN_DONE processed=${fastMessages.length}`);

    if (externalTerminalStop) {
      return buildEarlyExitResult();
    }

    if (options.fastOnly) {
      logScanLifecycle(log.id, "processing end");
      await maybeSaveScanProgress(true);
      const recordsSaved = paymentsCreated + invoicesCreated + tasksCreated + clientsCreated;
      logStep(`Found ${relevantEmailsFound} relevant emails (${invoiceEmails} invoices, ${receiptsFound} receipts, ${paymentRequestsFound} payment requests, ${supplierMessagesFound} supplier messages)`);
      logStep(`[gmail-sync] parser totals scanned=${fastMessages.length} parsed=${emailsParsed} rejected=${parserRejectedCount} rejectedReasons=${JSON.stringify(ignoredReasons)}`);
      logStep(`[gmail-sync] invoice detection totals positive=${invoiceDetectionPositive} negative=${invoiceDetectionNegative} invoicesCreated=${invoicesCreated}`);
      logStep(`[gmail-sync] DB totals emailMessageUpserts=${dbEmailMessageUpserts} gmailScanItemUpserts=${dbGmailScanItemUpserts} clientsCreated=${clientsCreated} potentialClients=${potentialClients} paymentsCreated=${paymentsCreated} invoicesCreated=${invoicesCreated}`);
      logStep(`[gmail-sync] Drive totals attempted=${driveUploadsAttempted} succeeded=${driveUploadsSucceeded} skipped=${driveUploadsSkipped} failed=${driveUploadsFailed}`);
      logStep(`Marked ${needsReviewCount} emails as Needs Review, extracted ${invoiceAmountsExtracted} amounts`);
      logStep(`Saved ${recordsSaved} records (${clientsCreated} clients, ${invoicesCreated} invoices, ${paymentsCreated} payments, ${tasksCreated} tasks)`);
      logStep(`Skipped ${duplicatesSkipped} duplicates or already processed emails`);
      const windowTruncated = listingDiagnosticsWindowTruncated(fastListing.diagnostics);
      if (windowTruncated) {
        logStep(`[gmail-sync] SCAN_WINDOW_TRUNCATED scanned=${fastMessages.length} maxMessages=${fastListing.diagnostics.maxMessages}`);
      }
      const fastFinalizeCounters = {
        emailsProcessed,
        emailsSaved: emailsSavedToGmailScanItem,
        invoicesFound: invoicesCreated + needsReviewCount,
        paymentsCreated,
        tasksCreated,
        driveUploaded: driveUploadsSucceeded,
        sheetsUpdated,
        errorsCount,
        totalMatched: fastMessages.length,
      };
      await finalizeGmailScanWithDeadlineGuard(
        log.id,
        scanStartedAt,
        deadlineTruncated,
        { ...fastFinalizeCounters, windowTruncated: deadlineTruncated ? true : windowTruncated },
        { phase: scanProgressPhase }
      );

      return {
        emailsProcessed,
        totalEmailsChecked: emailsProcessed,
        relevantEmailsFound,
        recordsSaved,
        clientsCreated,
        invoicesCreated,
        paymentsCreated,
        tasksCreated,
        uniqueSenders,
        potentialClients,
        invoiceEmails,
        invoiceAmountsExtracted,
        needsReviewCount,
        duplicatesSkipped,
        driveUploadsAttempted,
        driveUploadsSucceeded,
        driveUploadsFailed,
        driveUploadsSkipped,
        sheetsUpdated,
        parserRejectedCount,
        ignoredCount,
        ignoredReasons,
        errorsCount,
        scanSteps,
        emailsParsed,
        emailsSavedToGmailScanItem,
        windowTruncated,
        totalMatched: fastMessages.length,
        inProgress: false,
      };
    }

    if (deadlineTruncated) {
      await finalizeGmailScanWithDeadlineGuard(
        log.id,
        scanStartedAt,
        true,
        {
          emailsProcessed,
          emailsSaved: emailsSavedToGmailScanItem,
          invoicesFound: invoicesCreated + needsReviewCount,
          paymentsCreated,
          tasksCreated,
          driveUploaded: driveUploadsSucceeded,
          sheetsUpdated,
          errorsCount,
          windowTruncated: true,
          totalMatched: fastMessages.length,
        },
        { phase: scanProgressPhase }
      );
      return {
        emailsProcessed,
        totalEmailsChecked: emailsProcessed,
        relevantEmailsFound,
        recordsSaved: paymentsCreated + invoicesCreated + tasksCreated + clientsCreated,
        clientsCreated,
        invoicesCreated,
        paymentsCreated,
        tasksCreated,
        uniqueSenders,
        potentialClients,
        invoiceEmails,
        invoiceAmountsExtracted,
        needsReviewCount,
        duplicatesSkipped,
        driveUploadsAttempted,
        driveUploadsSucceeded,
        driveUploadsFailed,
        driveUploadsSkipped,
        sheetsUpdated,
        parserRejectedCount,
        ignoredCount,
        ignoredReasons,
        errorsCount,
        scanSteps,
        emailsParsed,
        emailsSavedToGmailScanItem,
        windowTruncated: true,
        totalMatched: fastMessages.length,
        inProgress: false,
      };
    }

    logStep(`[gmail-sync] Searching Gmail from last ${daysBack} days`);
    const listing = await listCandidateMessages(gmail, daysBack, options.maxMessages ?? MAX_MESSAGES_PER_SYNC, since, {
      scanAllMail: options.scanAllMail,
    });
    const historicalMessages = listing.messages.filter((message) => {
      if (message.id && fastMessageIds.has(message.id)) {
        logStep(`[gmail-sync] FAST_SCAN_SKIPPED_DUPLICATE message=${message.id} reason=historical_candidate_duplicate`);
        logStep(`[gmail-sync] DUPLICATE_SKIPPED org=${organizationId} reason=historical_candidate_duplicate key=${message.id} message=${message.id}`);
        return false;
      }
      return true;
    });
    const messages = [...fastMessages, ...historicalMessages];
    plannedTotalMatched = messages.length;
    logStep(`[gmail-sync] Gmail listing diagnostics ${JSON.stringify(listing.diagnostics)}`);
    logStep(`[gmail-sync] total emails fetched from Gmail=${messages.length} fast=${fastMessages.length} historical=${historicalMessages.length}`);
    const listingTruncated =
      listingDiagnosticsWindowTruncated(fastListing.diagnostics) ||
      listingDiagnosticsWindowTruncated(listing.diagnostics);
    const windowTruncated = listingTruncated;
    if (windowTruncated) {
      logStep(`[gmail-sync] SCAN_WINDOW_TRUNCATED scanned=${messages.length} maxMessages=${Math.max(fastListing.diagnostics.maxMessages, listing.diagnostics.maxMessages)}`);
    }
    await fetchAndParseMessages(historicalMessages, "historical");
    const historicalScannedEmails = scannedEmails.splice(0, scannedEmails.length);
    await processScannedEmails(historicalScannedEmails, "historical");
    logScanLifecycle(log.id, "processing end");
    await maybeSaveScanProgress(true);

    if (externalTerminalStop) {
      return buildEarlyExitResult();
    }

    async function processScannedEmails(emailsToProcess: ScannedEmail[], label: "fast" | "historical") {
    scanProgressPhase = "process";
    const senderCounts = new Map<string, { count: number; email: string; name: string; firstSeen: Date; lastSeen: Date }>();
    for (const email of emailsToProcess) {
      const current = senderCounts.get(email.domain);
      if (!current) {
        senderCounts.set(email.domain, {
          count: 1,
          email: email.senderEmail,
          name: email.senderName || email.domain,
          firstSeen: email.receivedAt,
          lastSeen: email.receivedAt,
        });
      } else {
        current.count++;
        if (email.receivedAt < current.firstSeen) current.firstSeen = email.receivedAt;
        if (email.receivedAt > current.lastSeen) current.lastSeen = email.receivedAt;
      }
    }
    uniqueSenders += senderCounts.size;
    logStep(`[gmail-sync] ${label} scan found ${senderCounts.size} unique senders`);
    const clientIdByDomain = new Map<string, string>();
    for (const [domain, sender] of senderCounts) {
      if (sender.count < 2) {
        logStep(`[gmail-sync] client candidate skipped domain="${domain || "unknown"}" email="${sender.email || "unknown"}" reason="single_message_sender" count=${sender.count}`);
        continue;
      }
      potentialClients++;
      logStep(`[gmail-sync] client candidate deferred domain="${domain || "unknown"}" email="${sender.email || "unknown"}" count=${sender.count}`);
    }
    logStep(`Found ${potentialClients} potential clients`);

    let processBatchNumber = 0;
    let stopProcessing = false;
    for (const batch of chunkArray(emailsToProcess, GMAIL_SCAN_BATCH_SIZE)) {
      if (await shouldStopScan()) {
        deadlineTruncated = true;
        break;
      }
      processBatchNumber++;
      logStep(`[gmail-sync] process ${label} batch ${processBatchNumber}/${Math.ceil(emailsToProcess.length / GMAIL_SCAN_BATCH_SIZE)} size=${batch.length}`);
      for (const email of batch) {
        if (stopProcessing) break;
        let scanItemPersisted = false;
        let currentDuplicateKey: string | null = null;
        let savedScanItemId: string | null = null;
        let driveSavedForPilot = false;
        let sheetsUpdatedForPilot = false;
        let invoicePersistedForPilot = false;
        let paymentPersistedForPilot = false;
        try {
      let clientId = clientIdByDomain.get(email.domain);
      if (clientId) {
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
      }

      if (email.alreadyProcessed && !options.forceReprocess) {
        if (scanMode === "fast_recurring") {
          const pendingDriveStatuses = ["pending_retry", "failed"];
          const pendingRepairCounts = await Promise.all([
            prisma.emailAttachment.count({
              where: {
                emailMessageId: email.emailRecordId,
                driveUploadStatus: { in: pendingDriveStatuses },
              },
            }),
            prisma.gmailScanItem.count({
              where: {
                organizationId,
                OR: [{ emailMessageId: email.emailRecordId }, { gmailMessageId: email.gmailId }],
                driveUploadStatus: { in: pendingDriveStatuses },
              },
            }),
            prisma.financialDocumentReview.count({
              where: {
                organizationId,
                OR: [{ emailMessageId: email.emailRecordId }, { gmailMessageId: email.gmailId }],
                driveUploadStatus: { in: pendingDriveStatuses },
              },
            }),
            prisma.supplierPayment.count({
              where: {
                organizationId,
                emailMessageId: email.emailRecordId,
                driveUploadStatus: { in: pendingDriveStatuses },
              },
            }),
            prisma.invoice.count({
              where: {
                organizationId,
                gmailMessageId: email.gmailId,
                driveUploadStatus: { in: pendingDriveStatuses },
              },
            }),
          ]);
          if (!pendingRepairCounts.some((count) => count > 0)) {
            logStep(`[gmail-sync] fast scan skip already-processed message=${email.gmailId} reason=no_pending_repair`);
            continue;
          }
          logStep(`[gmail-sync] fast scan reprocess already-processed message=${email.gmailId} reason=pending_repair`);
        } else {
          logStep(`[gmail-sync] message=${email.gmailId} already processed; still tracing parser/persistence before duplicate handling`);
        }
      }

      const pdfText = await extractPdfTextFromParts(gmail, email.gmailId, email.parts);
      const visualAttachmentHints = await extractVisualAttachmentHints(gmail, email.gmailId, email.parts, email.from, logStep, ownerEmails);
      const visualAttachmentText = visualAttachmentHints.text;
      const bodyForAnalysis = [email.bodyText, pdfText && `--- PDF ATTACHMENT TEXT ---\n${pdfText}`, visualAttachmentText && `--- VISUAL ATTACHMENT ANALYSIS ---\n${visualAttachmentText}`].filter(Boolean).join("\n\n");
      const driveLinkEvidence = evaluateGmailDriveLinkInvoiceEvidence({
        subject: email.subject,
        bodyText: email.bodyText,
      });
      const gmailAttachmentFilenames = email.parts.map((part) => part.filename).filter(Boolean) as string[];
      const attachmentFilenamesForClassification = [
        ...gmailAttachmentFilenames,
        ...driveLinkEvidence.virtualAttachmentFilenames,
      ];
      const supplierEvidenceText = [email.subject, bodyForAnalysis].filter(Boolean).join("\n\n");
      logStep(`[gmail-sync] parsed message=${email.gmailId} bodyLength=${email.bodyText.length} pdfTextLength=${pdfText.length} visualTextLength=${visualAttachmentText.length}`);
      if (driveLinkEvidence.links.length > 0) {
        logStep(
          `[gmail-sync] drive link scan message=${email.gmailId} links=${driveLinkEvidence.links.length} documentLinks=${driveLinkEvidence.virtualAttachmentFilenames.length} strictInvoiceEvidence=${driveLinkEvidence.hasStrictDriveInvoiceEvidence}`
        );
      }
      const junkDecision = classifyJunk({
        sender: email.senderEmail || email.from,
        subject: email.subject,
        body: bodyForAnalysis,
        channel: "gmail",
        attachmentFilenames: email.parts.map((part) => part.filename).filter(Boolean) as string[],
        metadata: { gmailMessageId: email.gmailId, domain: email.domain },
      });
      if (junkDecision.bucket === "CERTAIN_JUNK") {
        logStep(`[gmail-sync] junk dropped message=${email.gmailId} reason="${junkDecision.reason}"`);
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { processedAt: new Date() },
        });
        continue;
      }
      if (!shouldAutoClassifyAfterJunkFilter(junkDecision)) {
        needsReviewCount++;
        logStep(`[gmail-sync] junk needs_review message=${email.gmailId} reason="${junkDecision.reason}" blocklisted=${junkDecision.blocklisted}`);
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: email.senderEmail || email.from || null,
          subject: email.subject,
          fileName: primaryAttachmentFilename(email.parts),
          fileSize: null,
          supplierName: email.senderName || email.domain || null,
          supplierTaxId: null,
          invoiceNumber: null,
          documentDate: email.receivedAt,
          dueDate: null,
          amountBeforeVat: null,
          vatAmount: null,
          totalAmount: null,
          documentType: "payment_request",
          driveFileUrl: null,
          confidenceScore: 0,
          uncertaintyReason: `junk_filter:${junkDecision.reason}`,
          rawAnalysis: { junkDecision, gmailMessageId: email.gmailId },
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
        });
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { processedAt: new Date() },
        });
        continue;
      }
      const analysis = await analyzeEmailContent({
        subject: email.subject,
        body: bodyForAnalysis,
        filenames: attachmentFilenamesForClassification,
        sender: email.from,
      });
      logStep(`[gmail-sync] ai message=${email.gmailId} supplier="${analysis.supplier}" amount=${analysis.amount ?? "unknown"} documentType=${analysis.documentType} paymentRequired=${analysis.paymentRequired} confidence=${analysis.confidence}`);
      const ocrClassifierText = `${supplierEvidenceText}\n${analysis.supplier ?? ""}`;
      const ocrSupplierClassifier = classifyOcrSupplierText(ocrClassifierText);
      const cityDocument = detectMunicipalCollectionDocument(ocrClassifierText);
      if (cityDocument.detected) {
        logStep(`[gmail-sync] CITY_DOCUMENT_DETECTED message=${email.gmailId} supplier="${cityDocument.supplierName ?? "none"}" reason="${cityDocument.reason}"`);
      }
      logStep(`[gmail-sync] OCR_CLASSIFIER_INPUT message=${email.gmailId} chars=${ocrClassifierText.length} normalizedPreview="${truncateForLog(normalizeOcrSupplierText(ocrClassifierText), 500)}"`);
      logStep(`[gmail-sync] OCR_CLASSIFIER_RESULT message=${email.gmailId} supplier="${ocrSupplierClassifier?.supplierName ?? "none"}" confidence=${ocrSupplierClassifier?.confidence ?? 0} keyword="${ocrSupplierClassifier?.keyword ?? "none"}"`);
      const extractedFields = extractHebrewInvoiceFieldsFromText(`${supplierEvidenceText}\n${analysis.supplier ?? ""}`);
      const parsedFieldsJson: {
        amount: number | null;
        invoiceNumber: string | null;
        invoiceDate: string | null;
        dueDate: string | null;
        confidence: number;
        reasons: string[];
        arc: ReturnType<typeof summarizeMoneyDecision> | null;
        sir: ReturnType<typeof summarizeSupplierDecision> | null;
        fse: ReturnType<typeof summarizeFinancialSanityDecision> | null;
        trust: ReturnType<typeof summarizeTrustDecision> | null;
        outcome: ReturnType<typeof summarizeDocumentOutcome> | null;
        gates?: Array<AmountGateSnapshot | SupplierGateSnapshot | FingerprintGateSnapshot>;
        scfc?: ReturnType<typeof summarizeScfcResult>;
      } = {
        amount: extractedFields.amount,
        invoiceNumber: extractedFields.invoiceNumber,
        invoiceDate: extractedFields.invoiceDate,
        dueDate: extractedFields.dueDate,
        confidence: extractedFields.confidence,
        reasons: extractedFields.reasons,
        arc: null,
        sir: null,
        fse: null,
        trust: null,
        outcome: null,
      };
      if (extractedFields.amount !== null) {
        logStep(`[gmail-sync] AMOUNT_EXTRACTED message=${email.gmailId} amount=${extractedFields.amount} confidence=${extractedFields.confidence}`);
      }
      logStep(`[gmail-sync] AMOUNT_EXTRACTION_RESULT message=${email.gmailId} amount=${extractedFields.amount ?? "none"} status=${extractedFields.amount === null ? "failed" : "found"} reason="${extractedFields.reasons.find((reason) => reason.startsWith("amount_") || reason.includes("amount")) ?? "none"}"`);
      if (extractedFields.invoiceDate || extractedFields.dueDate) {
        logStep(`[gmail-sync] DATE_EXTRACTED message=${email.gmailId} invoiceDate=${extractedFields.invoiceDate ?? "none"} dueDate=${extractedFields.dueDate ?? "none"} confidence=${extractedFields.confidence}`);
      }
      if (extractedFields.invoiceNumber) {
        logStep(`[gmail-sync] INVOICE_NUMBER_EXTRACTED message=${email.gmailId} invoiceNumber="${extractedFields.invoiceNumber}" confidence=${extractedFields.confidence}`);
      }
      if (extractedFields.amount === null && !extractedFields.invoiceDate && !extractedFields.dueDate && !extractedFields.invoiceNumber) {
        logStep(`[gmail-sync] EXTRACTION_FAILED message=${email.gmailId} reason="${extractedFields.reasons.join(",")}"`);
      }
      const invoiceMatch = detectInvoice(email.subject, bodyForAnalysis, email.parts);
      if (invoiceMatch.isInvoice) invoiceDetectionPositive++;
      else invoiceDetectionNegative++;
      const moneyDecision = resolveGmailOrgMoneyDecision({
        organizationId,
        documentType: analysis.documentType,
        analysis,
        extractedFieldsAmount: extractedFields.amount,
        regexDetectedAmount: invoiceMatch.amount,
      });
      parsedFieldsJson.arc = summarizeMoneyDecision(moneyDecision);
      const finalTotalAmount = resolvePersistedTotalAmount(moneyDecision);
      const amount = finalTotalAmount;
      const amountRejectedReason =
        moneyDecision.status !== "resolved"
          ? moneyDecision.reason
          : invoiceMatch.amountRejectedReason ?? rejectedDetectedAmountReason(extractedFields.amount ?? analysis.totalAmount ?? analysis.amount);
      logStep(`[gmail-sync] invoice detection message=${email.gmailId} isInvoice=${invoiceMatch.isInvoice} detectedAmount=${invoiceMatch.amount ?? "none"} aiAmount=${analysis.amount ?? "none"} finalAmount=${amount ?? "none"} amountRejectedReason=${amountRejectedReason ?? "none"}`);
      const attachmentFilename =
        primaryAttachmentFilename(email.parts) ?? driveLinkEvidence.virtualAttachmentFilenames[0] ?? null;
      const supplierMetadata = resolveSupplierMetadata({
        analysisSupplier: analysis.supplier,
        analysisSupplierTaxId: analysis.supplierTaxId,
        bodyText: supplierEvidenceText,
        senderName: email.senderName,
        senderEmail: email.senderEmail,
        senderDomain: email.domain,
        ownerEmails,
        knownSupplierNames,
        ocrKeywordMatch: ocrSupplierClassifier,
        logStep,
      });
      parsedFieldsJson.sir = summarizeSupplierDecision(supplierMetadata.decision);
      const supplierName = supplierMetadata.name;
      const supplierBranchName = supplierBranchNameFromFolderName(supplierName);
      if (supplierMetadata.source === "unknown") {
        logStep(`[gmail-sync] SUPPLIER_NOT_FOUND message=${email.gmailId} reason="no OCR/document/AI/sender/domain supplier matched" analysisSupplier="${analysis.supplier}" ocrPreview="${truncateForLog(visualAttachmentText || pdfText || email.bodyText, 400)}"`);
      } else {
        logStep(`[gmail-sync] SUPPLIER_DETECTED message=${email.gmailId} supplier="${supplierName}" confidence=${supplierMetadata.confidence} source=${supplierMetadata.source}${supplierMetadata.keyword ? ` keyword="${supplierMetadata.keyword}"` : ""}`);
      }
      let classification = classifyGmailScanCandidate({
        subject: email.subject,
        bodyText: bodyForAnalysis,
        attachmentFilenames: attachmentFilenamesForClassification,
        analysis,
        amount,
        supplierName,
        senderName: email.senderName,
        senderEmail: email.senderEmail,
        senderDomain: email.domain,
        amountRejectedReason,
      });
      if (
        visualAttachmentHints.invoiceCandidateFound &&
        (visualAttachmentHints.needsReview || !isInvoiceRecordDocument(classification.documentType))
      ) {
        classification = promoteImageInvoiceCandidateForReview(classification, visualAttachmentHints.reviewReason);
      }
      classification = applySupplierDecisionReviewGate({
        classification,
        supplierDecision: supplierMetadata.decision,
      });
      const legacySupplierExpenseSignal = isIncomingSupplierExpenseCandidate({
        source: email.source,
        senderEmail: email.senderEmail,
        senderDomain: email.domain,
        supplierName,
        documentType: classification.documentType,
        paymentRequired: analysis.paymentRequired,
        ownerEmails,
      });
      const businessClassification = classifyBusinessDocument({
        sender: email.senderEmail || email.from,
        subject: email.subject,
        body: bodyForAnalysis,
        documentType: classification.documentType,
        supplierName,
        businessName: organization?.businessName ?? undefined,
        issuedBy: legacySupplierExpenseSignal ? supplierName : undefined,
        issuedTo: legacySupplierExpenseSignal ? organization?.businessName ?? undefined : undefined,
        paymentRequired: analysis.paymentRequired,
        channel: "gmail",
        metadata: { gmailMessageId: email.gmailId },
      });
      const pipelineAction = pipelineActionForClassification(businessClassification);
      const invoiceNeedsBusinessReview = pipelineAction === "NEEDS_REVIEW" && invoiceMatch.isInvoice;
      classification = applyBusinessReviewToInvoiceCandidate({
        classification,
        invoiceDetected: invoiceMatch.isInvoice,
        analysisDocumentType: analysis.documentType,
        businessClassification,
        pipelineAction,
      });
      const hasPdfOrImageAttachment = email.parts.some((part) => isPdfAttachmentPart(part) || isInvoiceImageAttachmentPart(part));
      const hasPdfOrImageDocumentEvidence =
        hasPdfOrImageAttachment || driveLinkEvidence.virtualAttachmentFilenames.length > 0;
      const hasStrictPaymentEvidence = Boolean(classification.audit.strictPaymentEvidence);
      if (
        shouldRejectPersonalEmailWithoutDocumentEvidence({
          isPersonalSender: isPersonalEmailSender(email.senderEmail, email.domain),
          hasPdfOrImageAttachment,
          strictPaymentEvidence: hasStrictPaymentEvidence,
          driveEvidence: driveLinkEvidence,
        })
      ) {
        logStep(`[gmail-sync] REJECTED no-attachment personal email without strict evidence message=${email.gmailId}`);
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { processedAt: new Date() },
        });
        continue;
      }
      if (pipelineAction === "NEEDS_REVIEW" && !invoiceMatch.isInvoice) {
        needsReviewCount++;
        logStep(`[gmail-sync] classifier needs_review message=${email.gmailId} reason="${businessClassification.reason}" direction=${businessClassification.direction} party=${businessClassification.party}`);
        const earlyInvoiceNumber = normalizeInvoiceNumberCandidate(analysis.invoiceNumber ?? "") ?? extractedFields.invoiceNumber ?? extractInvoiceNumber([email.subject, bodyForAnalysis, primaryAttachmentFilename(email.parts) ?? ""].join("\n"));
        const earlyDocumentDate = normalizeBusinessDate(analysis.invoiceDate ?? extractedFields.invoiceDate, email.receivedAt) ?? email.receivedAt;
        const earlyFseDecision = await runGmailOrgFinancialSanity({
          organizationId,
          supplierDecision: supplierMetadata.decision,
          moneyDecision,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: earlyInvoiceNumber,
          documentDate: earlyDocumentDate,
          dueDate: normalizeBusinessDate(analysis.dueDate ?? extractedFields.dueDate, null),
          documentType: classification.documentType,
          rawOcrText: [supplierEvidenceText, visualAttachmentText, pdfText].filter(Boolean).join("\n"),
          gmailMessageId: email.gmailId,
          logStep,
          contextCache: fseContextCache,
        });
        parsedFieldsJson.fse = summarizeFinancialSanityDecision(earlyFseDecision);
        attachAmountGateToParsedFields(parsedFieldsJson, {
          moneyDecision,
          fseSummary: parsedFieldsJson.fse,
        });
        attachSupplierGateToParsedFields(parsedFieldsJson, {
          supplierDecision: supplierMetadata.decision,
          supplierName,
          ownerEmails,
        });
        const earlyTrustDecision = runGmailOrgTrustDecision({
          organizationId,
          supplierDecision: supplierMetadata.decision,
          moneyDecision,
          fseDecision: earlyFseDecision,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: earlyInvoiceNumber,
          documentDate: earlyDocumentDate,
          documentType: classification.documentType,
          classification,
          extractedFieldsConfidence: extractedFields.confidence,
          hasPdfOrImageAttachment: hasPdfOrImageDocumentEvidence,
          visualNeedsReview: visualAttachmentHints.needsReview,
          contextCache: fseContextCache,
          gmailMessageId: email.gmailId,
          logStep,
        });
        parsedFieldsJson.trust = summarizeTrustDecision(earlyTrustDecision);
        classification = applyTrustReviewGate({ classification, trustDecision: earlyTrustDecision });
        const earlyDocumentOutcome = runGmailOrgOutcomeDecision({
          organizationId,
          trustDecision: earlyTrustDecision,
          fseDecision: earlyFseDecision,
          supplierDecision: supplierMetadata.decision,
          moneyDecision,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: earlyInvoiceNumber,
          documentDate: earlyDocumentDate,
          documentType: classification.documentType,
          classification,
          businessClassificationReason: businessClassification.reason,
          visualReviewReason: visualAttachmentHints.reviewReason,
          gmailMessageId: email.gmailId,
          logStep,
        });
        parsedFieldsJson.outcome = summarizeDocumentOutcome(earlyDocumentOutcome);
        classification = applyOutcomeReviewGate({ classification, documentOutcome: earlyDocumentOutcome });
        if (gmailOutcomeStopsPersistence(earlyDocumentOutcome.status)) {
          await recordFinancialDocumentDecision({
            organizationId,
            source: "gmail",
            sender: email.senderEmail || email.from || null,
            subject: email.subject,
            fileName: primaryAttachmentFilename(email.parts),
            fileSize: null,
            supplierName,
            supplierTaxId: supplierMetadata.taxId,
            invoiceNumber: earlyInvoiceNumber,
            documentDate: earlyDocumentDate,
            dueDate: normalizeBusinessDate(analysis.dueDate ?? extractedFields.dueDate, null),
            amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
            vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
            totalAmount: finalTotalAmount,
            documentType: "payment_request",
            driveFileUrl: null,
            confidenceScore: Math.min(classification.confidence, 0.79),
            uncertaintyReason: gmailOutcomeUncertaintyReason(earlyDocumentOutcome),
            forceNeedsReview: true,
            parsedFieldsJson,
            rawAnalysis: {
              analysis,
              classification,
              businessClassification,
              parsed_fields_json: parsedFieldsJson,
              gmailMessageId: email.gmailId,
            },
            emailMessageId: email.emailRecordId,
            gmailMessageId: email.gmailId,
          });
          await prisma.emailMessage.update({
            where: { id: email.emailRecordId },
            data: { processedAt: new Date() },
          });
          logStep(`[outcome] terminal path message=${email.gmailId} status=${earlyDocumentOutcome.status} reasonCode=${earlyDocumentOutcome.reasonCode}`);
          continue;
        }
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: email.senderEmail || email.from || null,
          subject: email.subject,
          fileName: primaryAttachmentFilename(email.parts),
          fileSize: null,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: earlyInvoiceNumber,
          documentDate: earlyDocumentDate,
          dueDate: normalizeBusinessDate(analysis.dueDate ?? extractedFields.dueDate, null),
          amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
          vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
          totalAmount: finalTotalAmount,
          documentType: "payment_request",
          driveFileUrl: null,
          confidenceScore: Math.min(classification.confidence, 0.79),
          uncertaintyReason: `classifier:${businessClassification.reason}`,
          parsedFieldsJson,
          rawAnalysis: {
            analysis,
            classification,
            businessClassification,
            parsed_fields_json: parsedFieldsJson,
            gmailMessageId: email.gmailId,
          },
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
        });
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { processedAt: new Date() },
        });
        continue;
      } else if (pipelineAction === "NEEDS_REVIEW") {
        logStep(`[gmail-sync] classifier needs_review invoice pass-through message=${email.gmailId} reason="${businessClassification.reason}" direction=${businessClassification.direction} party=${businessClassification.party}`);
      }
      const isIncomingSupplierExpense = pipelineAction === "SUPPLIER_EXPENSE";
      const isCustomerInvoice = pipelineAction === "CUSTOMER_INVOICE";
      if (isIncomingSupplierExpense && clientId) {
        logStep(`[gmail-sync] supplier expense message=${email.gmailId}; ignoring clientId=${clientId} to avoid supplier-as-client placeholder`);
        clientId = undefined;
      }
      const duplicateKey = buildGmailScanDuplicateKey({
        gmailMessageId: email.gmailId,
        attachmentFilename,
        supplierName,
        amount,
        subject: email.subject,
        occurredAt: email.receivedAt,
      });
      currentDuplicateKey = duplicateKey;
      const existingScanItem = await prisma.gmailScanItem.findUnique({
        where: { organizationId_duplicateKey: { organizationId, duplicateKey } },
      });
      if (existingScanItem) {
        logStep(`[gmail-sync] decision duplicate message=${email.gmailId} type=${existingScanItem.documentType} supplier="${existingScanItem.supplierName}" amount=${existingScanItem.amount ?? "unknown"}`);
        const existingScanItemAmount = Number(existingScanItem.amount);
        if (Number.isFinite(existingScanItemAmount) && existingScanItemAmount > 0) {
          duplicatesSkipped++;
          logStep(`[gmail-sync] DUPLICATE_SKIPPED org=${organizationId} reason=gmail_scan_item_exists key=${duplicateKey} message=${email.gmailId}`);
        } else {
          logStep(`[gmail-sync] REPROCESSING_EMPTY_DUPLICATE org=${organizationId} reason=gmail_scan_item_exists key=${duplicateKey} message=${email.gmailId}`);
        }
      }
      logStep(`[gmail-sync] decision message=${email.gmailId} type=${classification.documentType} confidence=${classification.confidenceScore} review=${classification.reviewStatus} reason="${classification.decisionReason}"`);

      if (classification.isRelevant) relevantEmailsFound++;
      if (classification.documentType === "invoice") invoiceEmails++;
      if (classification.documentType === "receipt") receiptsFound++;
      if (classification.documentType === "payment_request") paymentRequestsFound++;
      if (classification.documentType === "supplier_message") supplierMessagesFound++;
      if (invoiceMatch.amount !== null) invoiceAmountsExtracted++;
      const invoiceNumberForDecision = normalizeInvoiceNumberCandidate(analysis.invoiceNumber ?? "") ?? extractedFields.invoiceNumber ?? extractInvoiceNumber([email.subject, bodyForAnalysis, attachmentFilename ?? ""].join("\n"));
      const documentDateForDecision = normalizeBusinessDate(analysis.invoiceDate ?? extractedFields.invoiceDate, email.receivedAt) ?? email.receivedAt;
      const dueDateForDecision = normalizeBusinessDate(analysis.dueDate ?? extractedFields.dueDate, null);
      const fseDecision = await runGmailOrgFinancialSanity({
        organizationId,
        supplierDecision: supplierMetadata.decision,
        moneyDecision,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        documentDate: documentDateForDecision,
        dueDate: dueDateForDecision,
        documentType: classification.documentType,
        rawOcrText: [supplierEvidenceText, visualAttachmentText, pdfText].filter(Boolean).join("\n"),
        gmailMessageId: email.gmailId,
        logStep,
        contextCache: fseContextCache,
      });
      parsedFieldsJson.fse = summarizeFinancialSanityDecision(fseDecision);
      const amountGate = attachAmountGateToParsedFields(parsedFieldsJson, {
        moneyDecision,
        fseSummary: parsedFieldsJson.fse,
      });
      const supplierGate = attachSupplierGateToParsedFields(parsedFieldsJson, {
        supplierDecision: supplierMetadata.decision,
        supplierName,
        ownerEmails,
      });
      classification = applyFinancialSanityReviewGate({
        classification,
        fseDecision,
        amount: finalTotalAmount,
        rawOcrText: [supplierEvidenceText, visualAttachmentText, pdfText].filter(Boolean).join("\n"),
      });
      logStep(`[gmail-sync] FSE message=${email.gmailId} status=${fseDecision.overallStatus} trust=${fseDecision.trustScore} failed=${fseDecision.failedRules.join(",") || "none"}`);
      const trustDecision = runGmailOrgTrustDecision({
        organizationId,
        supplierDecision: supplierMetadata.decision,
        moneyDecision,
        fseDecision,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        documentDate: documentDateForDecision,
        documentType: classification.documentType,
        classification,
        extractedFieldsConfidence: extractedFields.confidence,
        hasPdfOrImageAttachment: hasPdfOrImageDocumentEvidence,
        visualNeedsReview: visualAttachmentHints.needsReview,
        contextCache: fseContextCache,
        gmailMessageId: email.gmailId,
        logStep,
      });
      parsedFieldsJson.trust = summarizeTrustDecision(trustDecision);
      classification = applyTrustReviewGate({ classification, trustDecision });
      const documentOutcome = runGmailOrgOutcomeDecision({
        organizationId,
        trustDecision,
        fseDecision,
        supplierDecision: supplierMetadata.decision,
        moneyDecision,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        documentDate: documentDateForDecision,
        documentType: classification.documentType,
        classification,
        existingScanItem,
        duplicateKey,
        businessClassificationReason: businessClassification.reason,
        visualReviewReason: visualAttachmentHints.reviewReason,
        gmailMessageId: email.gmailId,
        logStep,
      });
      parsedFieldsJson.outcome = summarizeDocumentOutcome(documentOutcome);
      classification = applyOutcomeReviewGate({ classification, documentOutcome });
      if (gmailOutcomeStopsPersistence(documentOutcome.status)) {
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: email.senderEmail || email.from || null,
          subject: email.subject,
          fileName: attachmentFilename,
          fileSize: null,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: invoiceNumberForDecision,
          documentDate: documentDateForDecision,
          dueDate: dueDateForDecision,
          amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
          vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
          totalAmount: finalTotalAmount,
          documentType: classification.documentType,
          driveFileUrl: null,
          confidenceScore: classification.confidence,
          uncertaintyReason: gmailOutcomeUncertaintyReason(documentOutcome),
          forceNeedsReview: true,
          parsedFieldsJson,
          rawAnalysis: {
            analysis,
            classification,
            businessClassification,
            parsed_fields_json: parsedFieldsJson,
            gmailMessageId: email.gmailId,
          },
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
        });
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { processedAt: new Date() },
        });
        logStep(`[outcome] terminal path message=${email.gmailId} status=${documentOutcome.status} reasonCode=${documentOutcome.reasonCode}`);
        continue;
      }
      if (classification.reviewStatus === "needs_review") needsReviewCount++;
      logStep(`[gmail-sync] CLASSIFICATION_RESULT message=${email.gmailId} documentType=${classification.documentType} review=${classification.reviewStatus} confidence=${classification.confidence} supplier="${supplierName}" amount=${amount ?? "none"} reason="${classification.decisionReason}"`);
      logStep(`[gmail-sync] PARSED_FIELDS_EXTRACTED message=${email.gmailId} supplier="${supplierName}" amount=${finalTotalAmount ?? "unknown"} invoiceNumber=${invoiceNumberForDecision ?? "unknown"} dueDate=${dueDateForDecision?.toISOString() ?? "unknown"} documentDate=${documentDateForDecision.toISOString()} documentType=${classification.documentType} review=${classification.reviewStatus}`);
      const scfcResult = computeCanonicalFingerprint({
        organizationId,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        totalAmount: finalTotalAmount,
        documentDate: documentDateForDecision,
        documentType: classification.documentType,
      });
      parsedFieldsJson.scfc = summarizeScfcResult(scfcResult);
      const identityStability = detectScanIdentityInstability({
        existingScanItem,
        current: {
          amount: finalTotalAmount,
          supplierName,
          documentDate: documentDateForDecision,
        },
      });
      let fingerprintGate = attachFingerprintGateToParsedFields(parsedFieldsJson, {
        scfc: scfcResult,
        documentFingerprint: scfcResult.fingerprint ?? scfcResult.legacyFingerprint,
        forceReprocess: options.forceReprocess,
        identityStability,
        hasAttachment: hasPdfOrImageDocumentEvidence,
      });
      const legacyDuplicateHash = buildLegacyDuplicateHashForLookup({
        organizationId,
        supplier: supplierName ?? "unknown",
        amount: finalTotalAmount ?? 0,
        dateIso: documentDateForDecision?.toISOString() ?? email.receivedAt.toISOString(),
        subject: email.subject,
      });
      const sameEmailPayment = email.emailRecordId
        ? await prisma.supplierPayment.findFirst({
            where: { organizationId, emailMessageId: email.emailRecordId },
            select: { id: true },
          })
        : null;
      const duplicateGateInput = await buildDuplicateGateInput({
        organizationId,
        source: "gmail",
        sender: email.senderEmail || email.from || null,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        totalAmount: finalTotalAmount,
        documentDate: documentDateForDecision,
        documentType: classification.documentType,
        fileSha256: null,
        documentFingerprint: scfcResult.fingerprint ?? scfcResult.legacyFingerprint,
        legacyDuplicateHash,
        legacyDuplicateKey: duplicateKey,
        scfcFingerprint: scfcResult.fingerprint,
        emailMessageId: email.emailRecordId,
        forceReprocess: options.forceReprocess,
        identityStability,
        amountRecoveredOnRescan: detectAmountRecoveredOnRescan({
          existingScanItem,
          currentAmount: finalTotalAmount,
        }),
        parsedFieldsJson,
        sameEmailAttachmentMatch: Boolean(sameEmailPayment),
      });
      let duplicateGate = attachDuplicateGateToParsedFields(parsedFieldsJson, duplicateGateInput);
      const documentValidationReason = financialDocumentBlockingReason({
        supplierName,
        invoiceNumber: invoiceNumberForDecision,
        totalAmount: finalTotalAmount,
        documentDate: documentDateForDecision,
        moneyDecision,
        fseSummary: parsedFieldsJson.fse,
        amountGate,
        supplierDecision: supplierMetadata.decision,
        supplierGate,
        fingerprintGate,
        duplicateGate,
        ownerEmails,
      });
      const documentDecision = await recordFinancialDocumentDecision({
        organizationId,
        source: "gmail",
        sender: email.senderEmail || email.from || null,
        subject: email.subject,
        fileName: attachmentFilename,
        fileSize: null,
        supplierName,
        supplierTaxId: supplierMetadata.taxId,
        invoiceNumber: invoiceNumberForDecision,
        documentDate: documentDateForDecision,
        dueDate: dueDateForDecision,
        amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
        vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
        totalAmount: finalTotalAmount,
        documentType: classification.documentType,
        driveFileUrl: null,
        confidenceScore: classification.confidence,
        uncertaintyReason:
          documentValidationReason ??
          moneyDecisionUncertaintySuffix(moneyDecision) ??
          (classification.reviewStatus === "needs_review" ? classification.decisionReason : null),
        forceNeedsReview: invoiceNeedsBusinessReview,
        parsedFieldsJson,
        rawAnalysis: {
          analysis,
          classification,
          businessClassification,
          parsed_fields_json: parsedFieldsJson,
          gmailMessageId: email.gmailId,
        },
        emailMessageId: email.emailRecordId,
        gmailMessageId: email.gmailId,
      });
      if (documentDecision.action === "duplicate") {
        fingerprintGate = attachFingerprintGateToParsedFields(parsedFieldsJson, {
          scfc: scfcResult,
          documentFingerprint: documentDecision.documentFingerprint,
          forceReprocess: options.forceReprocess,
          identityStability,
          confirmedDuplicate: true,
          hasAttachment: hasPdfOrImageDocumentEvidence,
        });
        duplicateGate = attachDuplicateGateToParsedFields(parsedFieldsJson, {
          ...duplicateGateInput,
          matchResult: "MATCH",
          matchReasons: ["fingerprint_match"],
          matchedCandidate: {
            id:
              ("payment" in documentDecision && documentDecision.payment?.id) ||
              duplicateGate.matchedPaymentId ||
              "confirmed-duplicate",
          },
        });
      }
      const canPersistFinancialRecord = documentDecision.action === "accepted";
      const outcomeAllowsAutoSavePersistence = documentOutcome.status === "SAVED";
      if (canPersistFinancialRecord && outcomeAllowsAutoSavePersistence && classification.reviewStatus === "auto_saved" && !clientId && !isIncomingSupplierExpense && classification.isRelevant && email.domain) {
        const saved = await upsertPotentialClient({
          organizationId,
          name: normalizeSupplierName(email.senderName || email.domain),
          email: email.senderEmail,
          domain: email.domain,
          firstSeen: email.receivedAt,
          lastSeen: email.receivedAt,
        });
        clientId = saved.id;
        clientIdByDomain.set(email.domain, saved.id);
        if (saved.created) clientsCreated++;
        if (canPersistFinancialRecord && outcomeAllowsAutoSavePersistence && classification.reviewStatus === "auto_saved") {
          const leadSaved = await upsertGmailLead({
            organizationId,
            name: normalizeSupplierName(email.senderName || supplierName || email.domain),
            company: supplierName || email.domain,
            email: email.senderEmail,
            phone: extractPhoneFromText(bodyForAnalysis),
            notes: `${email.subject}\n\n${bodyForAnalysis}`.slice(0, 1200),
          });
          logStep(`[gmail-sync] DB upsert Lead success message=${email.gmailId} id=${leadSaved.id} created=${leadSaved.created}`);
        }
        await prisma.emailMessage.update({
          where: { id: email.emailRecordId },
          data: { clientId },
        });
        logStep(`[gmail-sync] client/lead message=${email.gmailId} clientId=${clientId} clientCreated=${saved.created}`);
      }
      const driveLinks: GmailDriveLink[] = [];
      let driveUploadFailureReason: string | null = null;

      const shouldUploadAttachments =
        classification.isRelevant &&
        (
          (classification.reviewStatus === "auto_saved" && canPersistFinancialRecord && outcomeAllowsAutoSavePersistence) ||
          (documentOutcome.status === "NEEDS_REVIEW" && classification.reviewStatus === "needs_review" && isInvoiceRecordDocument(classification.documentType) && documentDecision.action !== "filtered")
        );
      for (const part of email.parts) {
        if (!shouldUploadAttachments) {
          driveUploadsSkipped++;
          logStep(`[gmail-sync] Drive upload skipped message=${email.gmailId} file="${part.filename || "unnamed"}" reason="${documentValidationReason ?? documentDecision.action ?? "not_auto_saved_invoice_or_payment"}"`);
          continue;
        }
        const attachmentId = part.body?.attachmentId;
        const filename = part.filename?.trim() || attachmentFilenameFromPart(part);
        if (!filename || !part.body) {
          driveUploadsSkipped++;
          driveUploadFailureReason = "missing_filename_or_body";
          logStep(`[gmail-sync] Drive upload skipped message=${email.gmailId} file="${filename || "unnamed"}" reason="missing_filename_or_body"`);
          if (shouldUploadAttachments && filename) {
            const failedAttachment = await markEmailAttachmentDriveStatus({
              emailMessageId: email.emailRecordId,
              filename,
              mimeType: part.mimeType,
              gmailAttachmentId: attachmentId ?? null,
              driveUploadStatus: "pending_retry",
            });
            console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=emailAttachment:${failedAttachment.id} reason=missing_filename_or_body`);
          }
          continue;
        }

        const existingAttachment = attachmentId
          ? await prisma.emailAttachment.findFirst({
              where: {
                emailMessageId: email.emailRecordId,
                gmailAttachmentId: attachmentId,
              },
            })
          : await prisma.emailAttachment.findFirst({
              where: {
                emailMessageId: email.emailRecordId,
                filename,
              },
            });
        if (existingAttachment?.driveLink) {
          await prisma.emailAttachment.update({
            where: { id: existingAttachment.id },
            data: { driveUploadStatus: "uploaded" },
          });
          driveLinks.push({
            type: folderForDocumentType(classification.documentType),
            link: existingAttachment.driveLink,
            filename,
            gmailAttachmentId: attachmentId ?? null,
            mimeType: part.mimeType ?? null,
            fileId: existingAttachment.driveFileId,
            folderId: existingAttachment.driveFolderId,
            clientFolderId: existingAttachment.driveClientFolderId,
            supplierFolderId: existingAttachment.driveSupplierFolderId,
            folderPath: existingAttachment.driveFolderPath,
            supplierName: existingAttachment.supplierName,
            invoiceMonth: existingAttachment.invoiceMonth,
            invoiceYear: existingAttachment.invoiceYear,
            fileSize: null,
          });
          driveUploadsSkipped++;
          driveSavedForPilot = true;
          logStep(`[gmail-sync] Drive upload skipped message=${email.gmailId} file="${filename}" reason="existing_drive_link" link=${existingAttachment.driveLink}`);
          logStep(`[gmail-sync] DRIVE_DUPLICATE_SKIPPED org=${organizationId} reason=existing_drive_link key=${attachmentId ?? filename} message=${email.gmailId} file="${filename}"`);
          continue;
        }

        const folderType = folderForDocumentType(classification.documentType);
        try {
          driveUploadsAttempted++;
          logStep(`[gmail-sync] Drive upload attempt message=${email.gmailId} file="${filename}" folder=${folderType}`);
          if (!rootId) {
            throw new Error("Drive root unavailable");
          }

          const data = await withRetry(
            () => attachmentData(gmail, email.gmailId, part),
            `[gmail-sync] Gmail attachment fetch retry message=${email.gmailId} file="${filename}"`
          );
          const buffer = decodeGmailAttachment(data);
          const fileSize = buffer.length;
          const fileSha256 = createHash("sha256").update(buffer).digest("hex");
          const fileMd5 = createHash("md5").update(buffer).digest("hex");
          const upload = await withRetry(
            () => uploadInvoiceAttachmentToDrive({
              organizationId,
              drive,
              rootFolderId: rootId,
              clientId: isIncomingSupplierExpense ? null : clientId,
              clientName: null,
              supplier: supplierName,
              supplierTaxId: supplierMetadata.taxId,
              documentType: classification.documentType,
              reviewStatus: classification.reviewStatus,
              filename,
              mimeType: part.mimeType,
              receivedAt: email.receivedAt,
              documentDate: documentDateForDecision,
              invoiceNumber: invoiceNumberForDecision,
              amount,
              totalAmount: finalTotalAmount,
              buffer,
              fileSha256,
              fileMd5,
            }),
            `[gmail-sync] Drive upload retry message=${email.gmailId} file="${filename}"`
          );
          const link = upload.webViewLink;
          driveLinks.push({
            type: folderType,
            link,
            filename,
            gmailAttachmentId: attachmentId ?? null,
            mimeType: part.mimeType ?? null,
            fileId: upload.fileId,
            folderId: upload.folderId,
            clientFolderId: upload.clientFolderId,
            supplierFolderId: upload.supplierFolderId,
            folderPath: upload.folderPath,
            supplierName: upload.supplierName,
            invoiceMonth: upload.invoiceMonth,
            invoiceYear: upload.invoiceYear,
            fileSize,
          });
          driveUploadsSucceeded++;
          logStep(`[gmail-sync] Drive upload success message=${email.gmailId} file="${filename}" link=${link ?? "none"}`);
          logStep(`[gmail-sync] DRIVE_FILE_SAVED org=${organizationId} message=${email.gmailId} file="${filename}" driveFileId=${upload.fileId ?? "none"} link=${link || "none"} folderId=${upload.folderId ?? "none"} folderPath="${upload.folderPath}"`);
          logStep(`[gmail-sync] DRIVE_UPLOAD_SUCCESS org=${organizationId} message=${email.gmailId} file="${filename}" driveFileId=${upload.fileId ?? "none"} link=${link || "none"} folderId=${upload.folderId ?? "none"} folderPath="${upload.folderPath}"`);
          driveSavedForPilot = true;
          if (existingAttachment) {
            await prisma.emailAttachment.update({
              where: { id: existingAttachment.id },
              data: {
                driveFileId: upload.fileId ?? undefined,
                driveLink: link,
                driveUploadStatus: "uploaded",
                driveFolderId: upload.folderId,
                driveClientFolderId: upload.clientFolderId,
                driveSupplierFolderId: upload.supplierFolderId,
                driveFolderPath: upload.folderPath,
                supplierName: upload.supplierName,
                invoiceMonth: upload.invoiceMonth,
                invoiceYear: upload.invoiceYear,
              },
            });
          } else {
            await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId ?? undefined,
                driveFileId: upload.fileId ?? undefined,
                driveLink: link,
                driveUploadStatus: "uploaded",
                driveFolderId: upload.folderId,
                driveClientFolderId: upload.clientFolderId,
                driveSupplierFolderId: upload.supplierFolderId,
                driveFolderPath: upload.folderPath,
                supplierName: upload.supplierName,
                invoiceMonth: upload.invoiceMonth,
                invoiceYear: upload.invoiceYear,
              },
            });
          }
        } catch (err) {
          driveUploadFailed = true;
          driveUploadsFailed++;
          errorsCount++;
          driveUploadFailureReason = shortDriveFailureReason(err);
          console.error("Drive upload failed; continuing Gmail sync without attachment upload", err);
          if (isGoogleReconnectRequiredError(err) || isInsufficientScopeError(err)) {
            logStep(`[gmail-sync] Google Drive reconnect required org=${organizationId} message=${email.gmailId} file="${filename}" reason="${err instanceof Error ? err.message : String(err)}"`);
          }
          logStep(`[gmail-sync] Drive upload failed message=${email.gmailId} file="${filename}" reason="${err instanceof Error ? err.message : String(err)}"`);
          if (existingAttachment) {
            await prisma.emailAttachment.update({
              where: { id: existingAttachment.id },
              data: { driveUploadStatus: "pending_retry" },
            });
            console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=emailAttachment:${existingAttachment.id} reason=${driveUploadFailureReason}`);
          } else {
            const failedAttachment = await prisma.emailAttachment.create({
              data: {
                emailMessageId: email.emailRecordId,
                filename,
                mimeType: part.mimeType ?? undefined,
                gmailAttachmentId: attachmentId ?? undefined,
                driveUploadStatus: "pending_retry",
              },
            });
            console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=emailAttachment:${failedAttachment.id} reason=${driveUploadFailureReason}`);
          }
        }
      }

      if (driveLinks.length === 0 && driveLinkEvidence.hasStrictDriveInvoiceEvidence) {
        for (const link of driveLinkEvidence.links) {
          if (link.documentKind === "unknown") continue;
          driveLinks.push({
            type: folderForDocumentType(classification.documentType),
            link: link.url,
            filename: link.inferredFilename,
            gmailAttachmentId: null,
            mimeType: link.documentKind === "pdf" ? "application/pdf" : "image/jpeg",
            fileId: link.fileId,
            fileSize: null,
          });
        }
        if (driveLinks.length > 0) {
          logStep(
            `[gmail-sync] DRIVE_LINK_BODY_REFERENCE message=${email.gmailId} link=${driveLinks[0]?.link ?? "none"} file="${driveLinks[0]?.filename ?? "unknown"}"`
          );
        }
      }

      const primaryDriveLink = driveLinks[0]?.link ?? null;
      const documentDriveUploadStatus =
        shouldUploadAttachments
          ? primaryDriveLink
            ? driveLinkEvidence.hasStrictDriveInvoiceEvidence && email.parts.length === 0
              ? "not_required"
              : "uploaded"
            : email.parts.length > 0
              ? "pending_retry"
              : "not_required"
          : "not_required";
      const documentDriveUploadFailureReason =
        documentDriveUploadStatus === "pending_retry"
          ? driveUploadFailureReason ?? "upload_missing_link"
          : null;
      if ("review" in documentDecision && documentDecision.review && primaryDriveLink) {
        const review = await prisma.financialDocumentReview.update({
          where: { id: documentDecision.review.id },
          data: { driveFileUrl: primaryDriveLink, driveUploadStatus: "uploaded" },
        });
        logStep(`[gmail-sync] INVOICE_DRIVE_LINK_SAVED org=${organizationId} target=financialDocumentReview id=${review.id} message=${email.gmailId} driveUrl=${primaryDriveLink}`);
      } else if ("review" in documentDecision && documentDecision.review && documentDriveUploadStatus === "pending_retry") {
        const review = await prisma.financialDocumentReview.update({
          where: { id: documentDecision.review.id },
          data: { driveUploadStatus: "pending_retry" },
        });
        console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=financialDocumentReview:${review.id} reason=${documentDriveUploadFailureReason}`);
      }

      logStep(`[gmail-sync] DB GmailScanItem upsert attempt message=${email.gmailId} duplicateKey=${documentDecision.documentFingerprint} legacyKey=${duplicateKey} type=${classification.documentType}`);
      const scanItemDuplicateKey = documentDecision.documentFingerprint;
      const upsertDuplicateKey = existingScanItem?.duplicateKey ?? scanItemDuplicateKey;
      const savedScanItem = await prisma.gmailScanItem.upsert({
        where: { organizationId_duplicateKey: { organizationId, duplicateKey: upsertDuplicateKey } },
        create: {
          organizationId,
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
          gmailMessageLink: gmailMessageLink(email.gmailId),
          sender: email.from || "unknown",
          senderEmail: email.senderEmail || null,
          subject: email.subject,
          occurredAt: email.receivedAt,
          amount,
          supplierName,
          documentType: classification.documentType,
          attachmentFilename,
          driveFileLink: driveLinks[0]?.link ?? null,
          driveUploadStatus: documentDriveUploadStatus,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          duplicateKey: scanItemDuplicateKey,
          decisionReason: classification.decisionReason,
          parsedFieldsJson,
          rawAnalysis: {
            analysis,
            audit: classification.audit,
            evidence: classification.evidence,
            confidence: classification.confidence,
            supplier: supplierMetadata,
            supplierTaxId: supplierMetadata.taxId,
            supplierBranchName,
            invoiceNumber: invoiceNumberForDecision,
            invoiceDate: documentDateForDecision.toISOString(),
            dueDate: dueDateForDecision?.toISOString() ?? null,
            parsed_fields_json: parsedFieldsJson,
            relevant: classification.isRelevant,
            ocrText: {
              pdfText,
              visualAttachmentText,
            },
            hasAttachment: email.parts.length > 0,
            filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
          },
        },
        update: {
          emailMessageId: email.emailRecordId,
          gmailMessageLink: gmailMessageLink(email.gmailId),
          sender: email.from || "unknown",
          senderEmail: email.senderEmail || null,
          subject: email.subject,
          occurredAt: email.receivedAt,
          amount,
          supplierName,
          documentType: classification.documentType,
          attachmentFilename,
          driveFileLink: driveLinks[0]?.link ?? existingScanItem?.driveFileLink ?? null,
          driveUploadStatus: driveLinks[0]?.link ? "uploaded" : documentDriveUploadStatus,
          confidenceScore: classification.confidenceScore,
          reviewStatus: classification.reviewStatus,
          duplicateKey: scanItemDuplicateKey,
          decisionReason: classification.decisionReason,
          parsedFieldsJson,
          rawAnalysis: {
            analysis,
            audit: classification.audit,
            evidence: classification.evidence,
            confidence: classification.confidence,
            supplier: supplierMetadata,
            supplierTaxId: supplierMetadata.taxId,
            supplierBranchName,
            invoiceNumber: invoiceNumberForDecision,
            invoiceDate: documentDateForDecision.toISOString(),
            dueDate: dueDateForDecision?.toISOString() ?? null,
            parsed_fields_json: parsedFieldsJson,
            relevant: classification.isRelevant,
            ocrText: {
              pdfText,
              visualAttachmentText,
            },
            hasAttachment: email.parts.length > 0,
            filenames: email.parts.flatMap((part) => part.filename ? [part.filename] : []),
          },
        },
      });
      scanItemPersisted = true;
      savedScanItemId = savedScanItem.id;
      emailsSavedToGmailScanItem++;
      dbGmailScanItemUpserts++;
      logStep(`[gmail-sync] saved GmailScanItem message=${email.gmailId} id=${savedScanItem.id} type=${savedScanItem.documentType} review=${savedScanItem.reviewStatus} relevant=${classification.isRelevant}`);
      if (documentDriveUploadStatus === "pending_retry") {
        console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=gmailScanItem:${savedScanItem.id} reason=${documentDriveUploadFailureReason}`);
      }
      if (savedScanItem.driveFileLink) {
        logStep(`[gmail-sync] DRIVE_URL_SAVED org=${organizationId} target=gmailScanItem id=${savedScanItem.id} message=${email.gmailId} driveUrl=${savedScanItem.driveFileLink}`);
        logStep(`[gmail-sync] INVOICE_DRIVE_LINK_SAVED org=${organizationId} target=gmailScanItem id=${savedScanItem.id} message=${email.gmailId} driveUrl=${savedScanItem.driveFileLink}`);
      }
      if (invoiceNeedsBusinessReview) {
        logStep(`[gmail-sync] INVOICE_SAVED_NEEDS_REVIEW message=${email.gmailId} id=${savedScanItem.id} type=${savedScanItem.documentType} reason="${businessClassification.reason}"`);
      }
      if (visualAttachmentHints.invoiceCandidateFound && savedScanItem.reviewStatus === "needs_review") {
        logStep(`[gmail-sync] IMAGE_INVOICE_SAVED_NEEDS_REVIEW message=${email.gmailId} id=${savedScanItem.id} type=${savedScanItem.documentType} reason="${classification.decisionReason}"`);
      }

      if (existingScanItem && !options.forceReprocess) {
        logStep(`[gmail-sync] duplicate GmailScanItem message=${email.gmailId}; continuing idempotent invoice/payment persistence`);
      }

      if (canPersistFinancialRecord && outcomeAllowsAutoSavePersistence && classification.reviewStatus === "auto_saved") {
        for (const taskTitle of analysis.tasks) {
          const existingTask = await prisma.task.findUnique({
            where: {
              organizationId_emailMessageId: {
                organizationId,
                emailMessageId: email.emailRecordId,
              },
            },
          });
          if (existingTask) continue;

          await prisma.task.upsert({
            where: {
              organizationId_emailMessageId: {
                organizationId,
                emailMessageId: email.emailRecordId,
              },
            },
            update: {},
            create: {
              organizationId,
              title: taskTitle,
              supplier: supplierName,
              priority: analysis.confidence < 0.7 ? "high" : "medium",
              source: email.source,
              emailMessageId: email.emailRecordId,
            },
          });
          tasksCreated++;
        }
      }

      if (isInvoiceRecordDocument(classification.documentType)) {
        if (!clientId) {
          if (isIncomingSupplierExpense) {
            logStep(`[gmail-sync] supplier expense invoice message=${email.gmailId}; skipping Client placeholder creation supplier="${supplierName}"`);
          } else if (canPersistFinancialRecord && outcomeAllowsAutoSavePersistence && classification.reviewStatus === "auto_saved") {
            const saved = await ensureInvoiceClient({
              organizationId,
              supplierName,
              senderEmail: email.senderEmail,
              domain: email.domain,
              receivedAt: email.receivedAt,
            });
            clientId = saved.id;
            if (email.domain) clientIdByDomain.set(email.domain, saved.id);
            if (saved.created) clientsCreated++;
            await prisma.emailMessage.update({
              where: { id: email.emailRecordId },
              data: { clientId },
            });
            logStep(`[gmail-sync] invoice client created message=${email.gmailId} clientId=${clientId} supplier="${supplierName}"`);
          }
        }
        logStep(`[gmail-sync] invoice detected message=${email.gmailId} type=${classification.documentType} clientId=${clientId ?? "none"} amount=${amount ?? "missing"} drive=${driveLinks[0]?.link ? "yes" : "no"}`);
      }

      if (isCustomerInvoice && documentDecision.action !== "filtered" && clientId && isInvoiceRecordDocument(classification.documentType)) {
        const invoiceParts = email.parts.filter((part) => isPdfAttachmentPart(part) || isInvoiceImageAttachmentPart(part));
        const shouldUseAttachmentInvoices = invoiceParts.length > 1 || invoiceParts.some(isInvoiceImageAttachmentPart);
        const createTargets = shouldUseAttachmentInvoices ? invoiceParts : [null];
        for (const invoicePart of createTargets) {
          const targetFilename = invoicePart ? attachmentFilenameForPart(invoicePart) : attachmentFilename;
          const targetAttachmentId = invoicePart?.body?.attachmentId ?? null;
          const targetDriveLink = invoicePart ? findDriveLinkForAttachment(driveLinks, invoicePart) : driveLinks[0];
          const targetAnalysis = invoicePart
            ? await analyzeInvoiceAttachmentForEmail({
                gmail,
                gmailMessageId: email.gmailId,
                part: invoicePart,
                subject: email.subject,
                bodyText: email.bodyText,
                sender: email.from,
              })
            : { skipped: false as const, analysis, attachmentText: "" };
          if (targetAnalysis.skipped) {
            logStep(`[gmail-sync] invoice attachment skipped message=${email.gmailId} file="${targetFilename ?? "unnamed"}" reason="${targetAnalysis.reason}"`);
            continue;
          }
          const targetBodyForDetection = invoicePart
            ? [email.bodyText, targetAnalysis.attachmentText && `--- ATTACHMENT OCR TEXT ---\n${targetAnalysis.attachmentText}`].filter(Boolean).join("\n\n")
            : bodyForAnalysis;
          const targetSupplierEvidenceText = [email.subject, targetBodyForDetection].filter(Boolean).join("\n\n");
          const targetInvoiceMatch = invoicePart
            ? detectInvoice(email.subject, targetBodyForDetection, [invoicePart])
            : invoiceMatch;
          if (invoicePart && !targetInvoiceMatch.isInvoice && !isInvoiceRecordDocument(normalizeInvoiceDocumentType(targetAnalysis.analysis.documentType, classification.documentType))) {
            logStep(`[gmail-sync] invoice PDF skipped message=${email.gmailId} file="${targetFilename ?? "unnamed"}" reason="per_pdf_not_invoice"`);
            continue;
          }

          const attachmentMoneyDecision = resolveGmailOrgMoneyDecision({
            organizationId,
            documentType: targetAnalysis.analysis.documentType,
            analysis: targetAnalysis.analysis,
            regexDetectedAmount: targetInvoiceMatch.amount,
            attachmentAnalysis: targetAnalysis.analysis,
          });
          const targetAmount = attachmentMoneyDecision.selectedAmount;
          const targetSupplierMetadata = invoicePart
            ? resolveSupplierMetadata({
                analysisSupplier: targetAnalysis.analysis.supplier,
                analysisSupplierTaxId: targetAnalysis.analysis.supplierTaxId,
                bodyText: targetSupplierEvidenceText,
                senderName: email.senderName,
                senderEmail: email.senderEmail,
                senderDomain: email.domain,
                ownerEmails,
                knownSupplierNames,
                logStep,
              })
            : supplierMetadata;
          const targetSupplierName = targetSupplierMetadata.name;
          if (invoicePart) {
            const targetOcrClassifierText = `${targetSupplierEvidenceText}\n${targetAnalysis.analysis.supplier ?? ""}`;
            const targetOcrSupplierClassifier = classifyOcrSupplierText(targetOcrClassifierText);
            logStep(`[gmail-sync] OCR_CLASSIFIER_INPUT message=${email.gmailId} file="${targetFilename ?? "unnamed"}" chars=${targetOcrClassifierText.length} normalizedPreview="${truncateForLog(normalizeOcrSupplierText(targetOcrClassifierText), 500)}"`);
            logStep(`[gmail-sync] OCR_CLASSIFIER_RESULT message=${email.gmailId} file="${targetFilename ?? "unnamed"}" supplier="${targetOcrSupplierClassifier?.supplierName ?? "none"}" confidence=${targetOcrSupplierClassifier?.confidence ?? 0} keyword="${targetOcrSupplierClassifier?.keyword ?? "none"}"`);
            if (targetSupplierMetadata.source === "unknown") {
              logStep(`[gmail-sync] SUPPLIER_NOT_FOUND message=${email.gmailId} file="${targetFilename ?? "unnamed"}" reason="no OCR/document/AI/sender/domain supplier matched" analysisSupplier="${targetAnalysis.analysis.supplier}" ocrPreview="${truncateForLog(targetAnalysis.attachmentText || targetBodyForDetection, 400)}"`);
            } else {
              logStep(`[gmail-sync] SUPPLIER_DETECTED message=${email.gmailId} file="${targetFilename ?? "unnamed"}" supplier="${targetSupplierName}" confidence=${targetSupplierMetadata.confidence} source=${targetSupplierMetadata.source}${targetSupplierMetadata.keyword ? ` keyword="${targetSupplierMetadata.keyword}"` : ""}`);
            }
          }
          const targetDocumentType = normalizeInvoiceDocumentType(targetAnalysis.analysis.documentType, classification.documentType);
          if (targetAmount == null) {
            logStep(`[gmail-sync] invoice amount missing message=${email.gmailId} file="${targetFilename ?? "body"}"; skipping customer invoice create`);
            continue;
          }
          const invoiceAmount = targetAmount;
          const invoiceNeedsReviewSave = classification.reviewStatus === "needs_review" || !isUsableSupplierName(targetSupplierName);
          const invoiceSupplierName = invoiceNeedsReviewSave && !isUsableSupplierName(targetSupplierName)
            ? UNKNOWN_SUPPLIER_FALLBACK
            : targetSupplierName;
          const invoiceNumber = targetAnalysis.analysis.invoiceNumber ?? extractInvoiceNumber([email.subject, targetBodyForDetection, targetFilename ?? ""].join("\n"));
          const invoiceDate = normalizeBusinessDate(targetAnalysis.analysis.invoiceDate, email.receivedAt) ?? email.receivedAt;
          const attachmentInvoiceDedupeKey = invoicePart
            ? buildInvoiceAttachmentDedupeKey({
                emailMessageId: email.emailRecordId,
                gmailMessageId: email.gmailId,
                attachmentFilename: targetFilename,
                gmailAttachmentId: targetAttachmentId,
              })
            : null;
          logStep(`[gmail-sync] DB Invoice insert attempt message=${email.gmailId} file="${targetFilename ?? "body"}" clientId=${clientId} supplier="${invoiceSupplierName}" amount=${invoiceAmount} invoiceNumber=${invoiceNumber ?? "none"} date=${invoiceDate.toISOString()} type=${targetDocumentType}`);
          try {
            const createdInvoice = await saveDetectedInvoice({
              organizationId,
              clientId,
              amount: invoiceAmount,
              currency: targetAnalysis.analysis.currency,
              date: invoiceDate,
              dueDate: normalizeBusinessDate(targetAnalysis.analysis.dueDate, null),
              invoiceNumber,
              supplierName: invoiceSupplierName,
              documentType: targetDocumentType,
              status: invoiceNeedsReviewSave ? "needs_review" : undefined,
              fromEmail: email.senderEmail,
              subject: email.subject,
              emailMessageId: email.emailRecordId,
              gmailMessageId: email.gmailId,
              invoiceDedupeKey: shouldUseAttachmentInvoices ? attachmentInvoiceDedupeKey : null,
              attachmentFilename: shouldUseAttachmentInvoices ? targetFilename : null,
              gmailAttachmentId: shouldUseAttachmentInvoices ? targetAttachmentId : null,
              allowMultipleInvoicesForMessage: shouldUseAttachmentInvoices,
              driveUrl: targetDriveLink?.link ?? null,
              driveFileId: targetDriveLink?.fileId ?? null,
              driveFileUrl: targetDriveLink?.link ?? null,
              driveUploadStatus: targetDriveLink?.link
                ? "uploaded"
                : shouldUploadAttachments && email.parts.length > 0
                  ? "pending_retry"
                  : "not_required",
              driveFolderId: targetDriveLink?.folderId ?? null,
              driveClientFolderId: targetDriveLink?.clientFolderId ?? null,
              driveSupplierFolderId: targetDriveLink?.supplierFolderId ?? null,
              driveFolderPath: targetDriveLink?.folderPath ?? null,
              invoiceMonth: targetDriveLink?.invoiceMonth ?? invoiceDate.getMonth() + 1,
              invoiceYear: targetDriveLink?.invoiceYear ?? invoiceDate.getFullYear(),
            });
            if (createdInvoice) {
              invoicesCreated++;
              invoicePersistedForPilot = true;
              if (createdInvoice.driveUploadStatus === "pending_retry") {
                console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=invoice:${createdInvoice.id} reason=${documentDriveUploadFailureReason ?? "upload_missing_link"}`);
              }
              logStep(`[gmail-sync] invoice save success message=${email.gmailId} file="${targetFilename ?? "body"}" invoiceId=${createdInvoice.id} amount=${invoiceAmount} supplier="${invoiceSupplierName}" drive=${targetDriveLink?.link ?? "none"}`);
            } else {
              duplicatesSkipped++;
              logStep(`[gmail-sync] duplicate invoice ignored message=${email.gmailId} file="${targetFilename ?? "body"}" supplier="${invoiceSupplierName}" invoiceNumber=${invoiceNumber ?? "none"} amount=${invoiceAmount} date=${invoiceDate.toISOString()}`);
              logStep(`[gmail-sync] DUPLICATE_SKIPPED org=${organizationId} reason=invoice_exists key=${invoiceNumber ?? targetFilename ?? email.gmailId} message=${email.gmailId}`);
            }
          } catch (err) {
            errorsCount++;
            logStep(`[gmail-sync] invoice save failed message=${email.gmailId} file="${targetFilename ?? "body"}" supplier="${invoiceSupplierName}" reason="${err instanceof Error ? err.message : String(err)}"`);
            throw err;
          }
        }
      } else {
        if (isInvoiceRecordDocument(classification.documentType) && classification.reviewStatus === "needs_review") {
          logStep(`[gmail-sync] invoice held for review message=${email.gmailId} reason="${classification.decisionReason}"`);
        } else {
          const reasons = [
            isIncomingSupplierExpense && "incoming_supplier_expense_saved_as_supplier_payment",
            isInvoiceRecordDocument(classification.documentType) && !clientId && "no_client_id",
            !isInvoiceRecordDocument(classification.documentType) && `document_type_${classification.documentType}`,
          ].filter(Boolean);
          logStep(`[gmail-sync] invoice rejected message=${email.gmailId} reason="${reasons.join(",") || "unknown"}"`);
        }
      }

      const senderEmailLower = (email.senderEmail ?? "").trim().toLowerCase();
      const senderIsOwner = !!senderEmailLower && ownerEmails.has(senderEmailLower);
      const paymentEligibility = supplierPaymentCreationEligibility({
        classification,
        amount,
        supplierName,
        senderIsOwner,
        supplierGate,
        fingerprintGate,
        duplicateGate,
      });
      const canPersistSupplierPayment = documentDecision.action !== "filtered" && !isCustomerInvoice && paymentEligibility.allowed;
      if (canPersistSupplierPayment) {
        const supplierPaymentNeedsReview = paymentEligibility.persistAsNeedsReview;
        const paymentSupplierName = supplierGate.canonicalSupplierName ?? supplierName;
        const paymentEvaluation = evaluateFinanceTrustGates({
          selectedAmount: finalTotalAmount,
          needsReview: supplierPaymentNeedsReview,
          amountGate,
          supplierGate,
          fingerprintGate,
          duplicateGate,
          documentType: documentDecision.documentType,
          confidenceScore: classification.confidence,
        });
        const paymentAmount = paymentEvaluation.paymentAmount;
        const paymentApprovalStatus = paymentEvaluation.approvalStatus;
        if (!paymentEvaluation.shouldCreatePayment) {
          logStep(`[gmail-sync] SUPPLIER_PAYMENT_SKIPPED message=${email.gmailId} reason=${paymentEvaluation.blockReason ?? FINANCE_AMOUNT_UNRESOLVED_REASON} status=${moneyDecision.status}`);
        } else {
        if (paymentAmount == null) {
          logStep(`[gmail-sync] SUPPLIER_PAYMENT_SKIPPED message=${email.gmailId} reason=unexpected_null_amount`);
        } else {
        const resolvedPaymentAmount = paymentAmount;
        const paymentIdentity = buildPaymentLookupsFromCanonical({
          organizationId,
          canonicalFingerprint: documentDecision.documentFingerprint,
          supplierName: paymentSupplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: invoiceNumberForDecision,
          totalAmount: resolvedPaymentAmount,
          documentDate: email.receivedAt,
          documentType: documentDecision.documentType,
          subject: email.subject,
          legacyGmailScanDuplicateKey: duplicateKey,
          sourceFingerprint: documentDecision.sourceFingerprint,
        });
        const duplicateHash = paymentIdentity.duplicateHash;

        const existingPayment = await findExistingSupplierPayment({
          organizationId,
          duplicateHash,
          lookupClauses: paymentIdentity.lookupClauses,
          emailMessageId: email.emailRecordId,
          supplier: paymentSupplierName,
          amount: paymentAmount,
          date: email.receivedAt,
        });

        const documentLink =
          classification.documentType === "payment_request"
            ? driveLinks[0]?.link
            : existingPayment?.documentLink;
        const invoiceLink =
          classification.documentType === "invoice" || classification.documentType === "receipt" || classification.documentType === "tax_invoice_receipt"
            ? driveLinks[0]?.link
            : existingPayment?.invoiceLink;

        const missingInvoice =
          Boolean(analysis.paymentRequired || classification.documentType === "payment_request") &&
          !invoiceLink &&
          Boolean(documentLink || analysis.paymentRequired);

        if (existingPayment) {
          const existingPaymentAmount = Number(existingPayment.amount);
          const existingPaymentTotalAmount = Number(existingPayment.totalAmount);
          const existingPaymentHasValidAmount =
            (Number.isFinite(existingPaymentAmount) && existingPaymentAmount > 0) ||
            (Number.isFinite(existingPaymentTotalAmount) && existingPaymentTotalAmount > 0);
          if (existingPaymentHasValidAmount) {
            duplicatesSkipped++;
          }
          paymentPersistedForPilot = true;
          logStep(`[gmail-sync] DB SupplierPayment update attempt message=${email.gmailId} id=${existingPayment.id}`);
          if (existingPaymentHasValidAmount) {
            logStep(`[gmail-sync] DUPLICATE_SKIPPED org=${organizationId} reason=supplier_payment_exists key=${duplicateHash} message=${email.gmailId} paymentId=${existingPayment.id}`);
          } else {
            logStep(`[gmail-sync] REPROCESSING_EMPTY_DUPLICATE org=${organizationId} reason=supplier_payment_exists key=${duplicateHash} message=${email.gmailId} paymentId=${existingPayment.id}`);
          }
          const updatedPayment = await prisma.supplierPayment.update({
            where: { id: existingPayment.id },
            data: {
              documentLink: documentLink ?? existingPayment.documentLink,
              invoiceLink: invoiceLink ?? existingPayment.invoiceLink,
              driveFileId: driveLinks[0]?.fileId ?? existingPayment.driveFileId,
              driveFileUrl: driveLinks[0]?.link ?? existingPayment.driveFileUrl,
              driveUploadStatus: driveLinks[0]?.link ? "uploaded" : existingPayment.driveUploadStatus ?? documentDriveUploadStatus,
              driveFolderId: driveLinks[0]?.folderId ?? existingPayment.driveFolderId,
              driveClientFolderId: driveLinks[0]?.clientFolderId ?? existingPayment.driveClientFolderId,
              driveSupplierFolderId: driveLinks[0]?.supplierFolderId ?? existingPayment.driveSupplierFolderId,
              driveFolderPath: driveLinks[0]?.folderPath ?? existingPayment.driveFolderPath,
              supplierName: driveLinks[0]?.supplierName ?? paymentSupplierName,
              invoiceMonth: driveLinks[0]?.invoiceMonth ?? existingPayment.invoiceMonth,
              invoiceYear: driveLinks[0]?.invoiceYear ?? existingPayment.invoiceYear,
              invoiceNumber: invoiceNumberForDecision ?? existingPayment.invoiceNumber,
              documentFingerprint: documentDecision.documentFingerprint,
              sourceFingerprint: documentDecision.sourceFingerprint,
              documentTypeDetailed: documentDecision.documentType,
              supplierTaxId: supplierMetadata.taxId ?? existingPayment.supplierTaxId,
              amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? existingPayment.amountBeforeVat,
              vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? existingPayment.vatAmount,
              totalAmount: finalTotalAmount ?? paymentAmount ?? existingPayment.totalAmount,
              confidenceScore: classification.confidence,
              parsedFieldsJson,
              approvalStatus: paymentApprovalStatus,
              sourcesJson: existingPayment.source === "whatsapp" || existingPayment.source === "both" ? ["gmail", "whatsapp"] : ["gmail"],
              missingInvoice,
              amount: paymentAmount ?? existingPayment.amount,
              dueDate: dueDateForDecision ?? existingPayment.dueDate,
              emailSender: email.from,
              lastSource: "gmail",
              source: existingPayment.source === "whatsapp" || existingPayment.source === "both" ? "both" : existingPayment.source,
              sourceCount: Math.max(existingPayment.sourceCount ?? 1, 1) + (existingPayment.source === "whatsapp" ? 1 : 0),
              duplicateDetected: existingPayment.source === "whatsapp" || existingPayment.duplicateDetected,
              duplicateReason: existingPayment.source === "whatsapp" ? "supplier_amount_invoice_date" : existingPayment.duplicateReason,
              firstSeenAt: existingPayment.firstSeenAt ?? existingPayment.createdAt,
              lastSeenAt: new Date(),
            },
          });
          if (updatedPayment.driveUploadStatus === "pending_retry") {
            console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=supplierPayment:${updatedPayment.id} reason=${documentDriveUploadFailureReason ?? "upload_missing_link"}`);
          }
          if (paymentEvaluation.shouldAppendToSheet) {
            await appendSupplierPaymentToSheet({
              organizationId,
              paymentId: existingPayment.id,
              supplier: paymentSupplierName,
              amount: paymentAmount ?? existingPayment.amount,
              date: email.receivedAt,
              dueDate: dueDateForDecision ?? existingPayment.dueDate,
              paid: existingPayment.paid,
              missingInvoice,
              documentLink,
              invoiceLink,
              gmailLink: gmailMessageLink(email.gmailId),
              supplierTaxId: supplierMetadata.taxId,
              invoiceNumber: invoiceNumberForDecision,
              invoiceDate: documentDateForDecision,
              source: existingPayment.source === "whatsapp" || existingPayment.source === "both" ? "both" : "gmail",
              duplicateDetected: existingPayment.source === "whatsapp" || existingPayment.duplicateDetected,
              duplicateReason: existingPayment.source === "whatsapp" ? "supplier_amount_invoice_date" : existingPayment.duplicateReason,
              driveFolderLink: driveLinks[0]?.folderId ? `https://drive.google.com/drive/folders/${driveLinks[0].folderId}` : null,
              paidDate: existingPayment.paid ? existingPayment.updatedAt : null,
              receiptLink: existingPayment.paid ? existingPayment.documentLink ?? existingPayment.invoiceLink : null,
              createdAt: existingPayment.createdAt,
              updatedAt: new Date(),
            }).then((sheet) => {
              sheetsUpdated++;
              sheetsUpdatedForPilot = true;
              logStep(`[gmail-sync] Sheets append success message=${email.gmailId} paymentId=${existingPayment.id} spreadsheet=${sheet.spreadsheetId}`);
            }).catch((err) => {
              console.error(`[gmail-sync] Sheets append failed message=${email.gmailId} paymentId=${existingPayment.id}`, err);
              logStep(`[gmail-sync] Sheets append failed message=${email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
            });
          } else {
            logStep(`[gmail-sync] Sheets append skipped message=${email.gmailId} paymentId=${existingPayment.id} reason="missing_amount_needs_review"`);
          }
          if (missingInvoice) {
            await createMissingInvoiceTaskOnce({
              organizationId,
              supplierName: paymentSupplierName,
              subject: email.subject,
              amount: resolvedPaymentAmount,
              emailMessageId: email.emailRecordId,
              gmailMessageId: email.gmailId,
            });
          } else if (invoiceLink) {
            await closeMissingInvoiceTask(organizationId, email.emailRecordId);
          }
          logStep(`[gmail-sync] updated SupplierPayment message=${email.gmailId} id=${existingPayment.id}`);
          if (supplierPaymentNeedsReview) {
            logStep(`[gmail-sync] SUPPLIER_PAYMENT_SAVED_NEEDS_REVIEW message=${email.gmailId} id=${existingPayment.id} reason="${classification.decisionReason}"`);
          }
        } else {
          const dueDate = dueDateForDecision;
          logStep(`[gmail-sync] DB SupplierPayment insert attempt message=${email.gmailId} amount=${paymentAmount} supplier="${paymentSupplierName}"`);
          const createResult = await createSupplierPaymentIfTrusted({
            evaluation: paymentEvaluation,
            data: {
              organizationId,
              supplier: paymentSupplierName,
              amount: resolvedPaymentAmount,
              currency: analysis.currency,
              date: email.receivedAt,
              dueDate,
              paid: false,
              documentLink,
              invoiceLink,
              driveFileId: driveLinks[0]?.fileId ?? null,
              driveFileUrl: driveLinks[0]?.link ?? null,
              driveUploadStatus: documentDriveUploadStatus,
              driveFolderId: driveLinks[0]?.folderId ?? null,
              driveClientFolderId: driveLinks[0]?.clientFolderId ?? null,
              driveSupplierFolderId: driveLinks[0]?.supplierFolderId ?? null,
              driveFolderPath: driveLinks[0]?.folderPath ?? null,
              supplierName: driveLinks[0]?.supplierName ?? paymentSupplierName,
              invoiceMonth: driveLinks[0]?.invoiceMonth ?? email.receivedAt.getMonth() + 1,
              invoiceYear: driveLinks[0]?.invoiceYear ?? email.receivedAt.getFullYear(),
              invoiceNumber: invoiceNumberForDecision,
              documentFingerprint: documentDecision.documentFingerprint,
              sourceFingerprint: documentDecision.sourceFingerprint,
              documentTypeDetailed: documentDecision.documentType,
              supplierTaxId: supplierMetadata.taxId,
              amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
              vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
              totalAmount: finalTotalAmount ?? paymentAmount ?? null,
              confidenceScore: classification.confidence,
              parsedFieldsJson,
              approvalStatus: paymentApprovalStatus,
              sourcesJson: ["gmail"],
              emailSender: email.from,
              paymentRequired: analysis.paymentRequired,
              missingInvoice,
              duplicateHash,
              subject: email.subject,
              source: email.source,
              emailMessageId: email.emailRecordId,
            },
          });
          if (createResult.skipped || !createResult.payment) {
            logStep(`[gmail-sync] SUPPLIER_PAYMENT_SKIPPED message=${email.gmailId} reason=${createResult.reason ?? "trust_gate_blocked"}`);
          } else {
          const payment = createResult.payment;
          paymentsCreated++;
          paymentPersistedForPilot = true;
          if (payment.driveUploadStatus === "pending_retry") {
            console.log(`DRIVE UPLOAD FAILED org=${organizationId} doc=supplierPayment:${payment.id} reason=${documentDriveUploadFailureReason ?? "upload_missing_link"}`);
          }
          if (paymentEvaluation.shouldAppendToSheet) {
            await appendSupplierPaymentToSheet({
              organizationId,
              paymentId: payment.id,
              supplier: paymentSupplierName,
              amount: resolvedPaymentAmount,
              date: email.receivedAt,
              dueDate,
              paid: false,
              missingInvoice,
              documentLink,
              invoiceLink,
              gmailLink: gmailMessageLink(email.gmailId),
              supplierTaxId: supplierMetadata.taxId,
              invoiceNumber: invoiceNumberForDecision,
              invoiceDate: documentDateForDecision,
              source: "gmail",
              duplicateDetected: false,
              duplicateReason: null,
              driveFolderLink: driveLinks[0]?.folderId ? `https://drive.google.com/drive/folders/${driveLinks[0].folderId}` : null,
              paidDate: payment.paid ? payment.updatedAt : null,
              receiptLink: payment.paid ? payment.documentLink ?? payment.invoiceLink : null,
              createdAt: payment.createdAt,
              updatedAt: payment.updatedAt,
            }).then((sheet) => {
              sheetsUpdated++;
              sheetsUpdatedForPilot = true;
              logStep(`[gmail-sync] Sheets append success message=${email.gmailId} paymentId=${payment.id} spreadsheet=${sheet.spreadsheetId}`);
            }).catch((err) => {
              console.error(`[gmail-sync] Sheets append failed message=${email.gmailId} paymentId=${payment.id}`, err);
              logStep(`[gmail-sync] Sheets append failed message=${email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
            });
          } else {
            logStep(`[gmail-sync] Sheets append skipped message=${email.gmailId} paymentId=${payment.id} reason="missing_amount_needs_review"`);
          }
          logStep(`[gmail-sync] saved SupplierPayment message=${email.gmailId} id=${payment.id} amount=${paymentAmount} supplier="${paymentSupplierName}"`);
          if (supplierPaymentNeedsReview) {
            logStep(`[gmail-sync] SUPPLIER_PAYMENT_SAVED_NEEDS_REVIEW message=${email.gmailId} id=${payment.id} reason="${classification.decisionReason}"`);
          }

          if (classification.documentType === "invoice" || classification.documentType === "tax_invoice_receipt" || missingInvoice) {
            await createPaymentAlertOnce({
              organizationId,
              type: missingInvoice ? "missing_invoice" : "new_invoice",
              supplierName: paymentSupplierName,
              subject: email.subject,
              amount: resolvedPaymentAmount,
              gmailMessageId: email.gmailId,
            });
            if (missingInvoice) {
              await createMissingInvoiceTaskOnce({
                organizationId,
                supplierName: paymentSupplierName,
                subject: email.subject,
                amount: resolvedPaymentAmount,
                emailMessageId: email.emailRecordId,
                gmailMessageId: email.gmailId,
              });
            }
            if (!missingInvoice) {
              await notifyNewInvoice(organizationId, paymentSupplierName, paymentAmount);
            }
          }
          }
        }
        }
        }
      } else {
        const reasons = [
          documentDecision.action === "filtered" && "financial_document_filtered",
          ...paymentEligibility.reasons,
        ].filter(Boolean);
        logStep(`[gmail-sync] SupplierPayment save skipped message=${email.gmailId} reason="${reasons.join(",") || "unknown"}"`);
      }

      if (documentDecision.action !== "filtered" && classification.isRelevant && driveLinks.length > 0) {
        const driveSync = await ensureSupplierPaymentsForDriveLinks({
          organizationId,
          email,
          driveLinks,
          classification,
          analysis,
          amount,
          supplierName,
          supplierMetadata,
          invoiceNumber: invoiceNumberForDecision,
          documentDate: documentDateForDecision,
          dueDate: dueDateForDecision,
          parsedFieldsJson,
          documentDecision,
          duplicateKey,
          logStep,
        });
        paymentsCreated += driveSync.created;
        sheetsUpdated += driveSync.sheetsUpdated;
        if (driveSync.created > 0) paymentPersistedForPilot = true;
        if (driveSync.sheetsUpdated > 0) sheetsUpdatedForPilot = true;
      }

      if (
        documentDecision.action === "accepted" &&
        classification.isRelevant &&
        !invoicePersistedForPilot &&
        !paymentPersistedForPilot
      ) {
        logStep(`[gmail-sync] persistence fallback needs_review message=${email.gmailId} reason="no_invoice_or_supplier_payment_created"`);
        await recordFinancialDocumentDecision({
          organizationId,
          source: "gmail",
          sender: email.senderEmail || email.from || null,
          subject: email.subject,
          fileName: attachmentFilename,
          fileSize: null,
          supplierName,
          supplierTaxId: supplierMetadata.taxId,
          invoiceNumber: invoiceNumberForDecision,
          documentDate: documentDateForDecision,
          dueDate: dueDateForDecision,
          amountBeforeVat: moneyDecision.amountBeforeVat ?? analysis.amountBeforeVat ?? null,
          vatAmount: moneyDecision.vatAmount ?? analysis.vatAmount ?? null,
          totalAmount: finalTotalAmount,
          documentType: classification.documentType,
          driveFileUrl: driveLinks[0]?.link ?? null,
          confidenceScore: Math.min(classification.confidence, 0.79),
          uncertaintyReason: "no invoice or supplier payment was created",
          forceNeedsReview: true,
          parsedFieldsJson,
          rawAnalysis: {
            analysis,
            classification,
            businessClassification,
            parsed_fields_json: parsedFieldsJson,
            gmailMessageId: email.gmailId,
          },
          emailMessageId: email.emailRecordId,
          gmailMessageId: email.gmailId,
        });
      }

      await prisma.emailMessage.update({
        where: { id: email.emailRecordId },
        data: { processedAt: new Date() },
      });
      logStep(`[gmail-sync] DB mark processed success message=${email.gmailId}`);
      if (classification.isRelevant && (savedScanItemId || invoicePersistedForPilot || paymentPersistedForPilot)) {
        logStep(
          `[gmail-sync] PILOT_FLOW_SUCCESS org=${organizationId} message=${email.gmailId} scanItem=${savedScanItemId ?? "none"} invoice=${invoicePersistedForPilot} payment=${paymentPersistedForPilot} drive=${driveSavedForPilot || Boolean(driveLinks[0]?.link)} sheets=${sheetsUpdatedForPilot} type=${classification.documentType} review=${classification.reviewStatus}`
        );
      }
        } catch (err) {
          errorsCount++;
          console.error(`[gmail-sync] processing failed message=${email.gmailId}`, err);
          logStep(`[gmail-sync] error message=${email.gmailId} stage=process_save reason="${err instanceof Error ? err.message : String(err)}"`);
          if (!scanItemPersisted) {
            try {
              await saveRejectedScanItem(email, `process_save_failed: ${err instanceof Error ? err.message : String(err)}`);
              await prisma.emailMessage.update({
                where: { id: email.emailRecordId },
                data: { processedAt: new Date() },
              });
            } catch (fallbackErr) {
              console.error(`[gmail-sync] fallback GmailScanItem save failed message=${email.gmailId}`, fallbackErr);
              logStep(`[gmail-sync] error message=${email.gmailId} stage=fallback_scan_item_save reason="${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}"`);
            }
          } else if (currentDuplicateKey) {
            try {
              await prisma.gmailScanItem.update({
                where: { organizationId_duplicateKey: { organizationId, duplicateKey: currentDuplicateKey } },
                data: {
                  reviewStatus: "needs_review",
                  decisionReason: `process_save_failed: ${err instanceof Error ? err.message : String(err)}`,
                },
              });
            } catch (markErr) {
              console.error(`[gmail-sync] failed marking GmailScanItem error message=${email.gmailId}`, markErr);
              logStep(`[gmail-sync] error message=${email.gmailId} stage=mark_scan_item_error reason="${markErr instanceof Error ? markErr.message : String(markErr)}"`);
            }
          }
        } finally {
          emailsAnalyzedInProcessing++;
          await maybeSaveScanProgress();
          if (await shouldStopScan()) {
            deadlineTruncated = true;
            stopProcessing = true;
            break;
          }
        }
      }
      if (stopProcessing) break;
    }
    }

    const recordsSaved = paymentsCreated + invoicesCreated + tasksCreated + clientsCreated;
    logStep(`Found ${relevantEmailsFound} relevant emails (${invoiceEmails} invoices, ${receiptsFound} receipts, ${paymentRequestsFound} payment requests, ${supplierMessagesFound} supplier messages)`);
    logStep(`[gmail-sync] parser totals scanned=${messages.length} parsed=${emailsParsed} rejected=${parserRejectedCount} rejectedReasons=${JSON.stringify(ignoredReasons)}`);
    logStep(`[gmail-sync] invoice detection totals positive=${invoiceDetectionPositive} negative=${invoiceDetectionNegative} invoicesCreated=${invoicesCreated}`);
    logStep(`[gmail-sync] DB totals emailMessageUpserts=${dbEmailMessageUpserts} gmailScanItemUpserts=${dbGmailScanItemUpserts} clientsCreated=${clientsCreated} potentialClients=${potentialClients} paymentsCreated=${paymentsCreated} invoicesCreated=${invoicesCreated}`);
    logStep(`[gmail-sync] Drive totals attempted=${driveUploadsAttempted} succeeded=${driveUploadsSucceeded} skipped=${driveUploadsSkipped} failed=${driveUploadsFailed}`);
    logStep(`Saved ${emailsSavedToGmailScanItem}/${emailsProcessed} fetched emails to GmailScanItem`);
    logStep(`Ignored ${ignoredCount} emails with reasons: ${JSON.stringify(ignoredReasons)}`);
    logStep(`Marked ${needsReviewCount} emails as Needs Review, extracted ${invoiceAmountsExtracted} amounts`);
    logStep(`Saved ${recordsSaved} records (${clientsCreated} clients, ${invoicesCreated} invoices, ${paymentsCreated} payments, ${tasksCreated} tasks)`);
    logStep(`Skipped ${duplicatesSkipped} duplicates or already processed emails`);
    const { backfillInvoicesFromGmailScanItems } = await import("./invoiceBackfill.js");
    const invoiceBackfill = await backfillInvoicesFromGmailScanItems(organizationId, 200);
    if (invoiceBackfill.created || invoiceBackfill.errors.length) {
      logStep(`[gmail-sync] invoice backfill candidates=${invoiceBackfill.candidates} created=${invoiceBackfill.created} duplicates=${invoiceBackfill.duplicates} skipped=${invoiceBackfill.skipped} errors=${invoiceBackfill.errors.length}`);
    }

    const fullFinalizeCounters = {
      emailsProcessed,
      emailsSaved: emailsSavedToGmailScanItem,
      invoicesFound: invoicesCreated + needsReviewCount + invoiceBackfill.created,
      paymentsCreated,
      tasksCreated,
      driveUploaded: driveUploadsSucceeded,
      sheetsUpdated,
      errorsCount,
      totalMatched: plannedTotalMatched ?? messages.length,
    };
    await finalizeGmailScanWithDeadlineGuard(
      log.id,
      scanStartedAt,
      deadlineTruncated,
      { ...fullFinalizeCounters, windowTruncated: deadlineTruncated ? true : windowTruncated },
      { phase: scanProgressPhase }
    );

    return {
      emailsProcessed,
      totalEmailsChecked: emailsProcessed,
      relevantEmailsFound,
      emailsFound: emailsProcessed,
      paymentsCreated,
      tasksCreated,
      clientsCreated,
      invoicesCreated,
      invoiceBackfillCreated: invoiceBackfill.created,
      receiptsFound,
      paymentRequestsFound,
      supplierMessagesFound,
      duplicatesSkipped,
      recordsSaved,
      needsReviewCount,
      errorsCount,
      emailsSavedToGmailScanItem,
      emailsParsed,
      parserRejectedCount,
      dbEmailMessageUpserts,
      dbGmailScanItemUpserts,
      driveUploadsAttempted,
      driveUploadsSucceeded,
      driveUploadsSkipped,
      driveUploadsFailed,
      sheetsUpdated,
      windowTruncated,
      totalMatched: messages.length,
      invoiceDetectionPositive,
      invoiceDetectionNegative,
      ignoredCount,
      ignoredReasons,
      uniqueSenders,
      potentialClients,
      invoiceEmails,
      invoiceAmountsExtracted,
      driveUploadFailed,
      scanSteps,
      message: driveUploadFailed ? DRIVE_FULL_MESSAGE : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (log) {
      await finalizeGmailScanFailed(log.id, message, {
        errorsCount: Math.max(errorsCount, 1),
        emailsProcessed,
        emailsSaved: emailsSavedToGmailScanItem,
        totalMatched: plannedTotalMatched ?? undefined,
      }, { phase: scanProgressPhase, reason: message });
    }
    throw err;
  } finally {
    if (log) {
      await ensureGmailScanTerminalized(log.id);
    }
  }
}

export type PayloadPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; data?: string | null } | null;
  parts?: PayloadPart[] | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
};

type GmailClient = Awaited<ReturnType<typeof getGoogleClients>>["gmail"];
type GmailMessageRef = { id?: string | null; threadId?: string | null };
export type GmailListingDiagnostics = {
  requestedDaysBack: number;
  dateFilter: string;
  maxMessages: number;
  scanAllMail: boolean;
  totalGmailMessagesFound: number;
  pagesProcessed: number;
  messagesProcessed: number;
  nextPageTokenUses: number;
  queries: Array<{
    query: string;
    pagesProcessed: number;
    messagesSeen: number;
    uniqueMessagesAfterQuery: number;
    nextPageTokensSeen: number;
    stoppedBecauseMaxReached: boolean;
  }>;
};
type GmailDocumentType = "invoice" | "receipt" | "tax_invoice_receipt" | "payment_request" | "quote" | "supplier_message" | "unknown_needs_review";
type GmailConfidenceScore = "high" | "medium" | "low" | `${number}%`;
type ScannedEmail = {
  gmailId: string;
  emailRecordId: string;
  subject: string;
  from: string;
  senderEmail: string;
  senderName: string;
  domain: string;
  bodyText: string;
  receivedAt: Date;
  source: string;
  parts: PayloadPart[];
  fullPayload?: PayloadPart;
  alreadyProcessed: boolean;
};

export type GmailScanClassification = {
  documentType: GmailDocumentType;
  confidenceScore: GmailConfidenceScore;
  confidence: number;
  reviewStatus: "auto_saved" | "needs_review";
  isRelevant: boolean;
  decisionReason: string;
  evidence: string[];
  audit: {
    keywordMatched: string[];
    attachmentFound: boolean;
    amountFound: boolean;
    supplierDetected: boolean;
    blockedReason: string | null;
    invoiceAttached: boolean;
    receiptAttached: boolean;
    supplierPaymentRequestDetected: boolean;
    taxInvoiceDetected: boolean;
    pdfInvoiceDetected: boolean;
    imageInvoiceDetected: boolean;
    strictPaymentEvidence: boolean;
  };
  heldForFinancialSender: boolean;
  financialSenderReason: string | null;
};

export function applySupplierDecisionReviewGate(input: {
  classification: GmailScanClassification;
  supplierDecision: SupplierDecision;
}): GmailScanClassification {
  const decision = input.supplierDecision;
  if (decision.status === "resolved" && decision.isStrongEnoughForAutoSave) {
    return input.classification;
  }
  if (input.classification.reviewStatus === "needs_review") {
    return {
      ...input.classification,
      decisionReason: `${input.classification.decisionReason}; supplier_${decision.status}:${decision.reasonCode}`.slice(0, 500),
    };
  }
  return {
    ...input.classification,
    reviewStatus: "needs_review",
    decisionReason: `${input.classification.decisionReason}; supplier_${decision.status}:${decision.reasonCode}`.slice(0, 500),
    confidence: Math.min(input.classification.confidence, Math.max(decision.confidence, 0.4)),
  };
}

const FSE_REVIEW_ESCALATING_WARNING_RULES = new Set<SanityRuleId>([
  "ocr_suspicious_patterns",
  "vat_arithmetic",
  "supplier_historical_range",
  "impossible_amount",
]);

export function shouldEscalateFseWarningToReview(
  decision: FinancialSanityDecision,
  options?: { amount?: number | null; rawOcrText?: string | null }
): boolean {
  if (decision.overallStatus !== "warning") {
    if (decision.overallStatus === "valid" && hasRepeatedDigitOcrPattern(options?.amount ?? null, options?.rawOcrText ?? "")) {
      return true;
    }
    return false;
  }
  if (decision.failedRules.some((ruleId) => FSE_REVIEW_ESCALATING_WARNING_RULES.has(ruleId))) {
    return true;
  }
  return hasRepeatedDigitOcrPattern(options?.amount ?? null, options?.rawOcrText ?? "");
}

function hasRepeatedDigitOcrPattern(amount: number | null, rawOcrText: string): boolean {
  if (amount == null) return false;
  const digits = String(Math.round(Math.abs(amount)));
  if (digits.length >= 4 && /^(\d)\1+$/.test(digits)) return true;
  if (digits.length >= 6) {
    for (let size = 2; size <= 3; size += 1) {
      if (digits.length % size === 0 && digits.length / size >= 2) {
        const chunk = digits.slice(0, size);
        if (chunk.repeat(digits.length / size) === digits) return true;
      }
    }
  }
  return /(\d{2,3})[,\s]?\1/.test(rawOcrText);
}

export function deriveGmailTrustDuplicateRisk(
  fseDecision: FinancialSanityDecision,
  fingerprint: ReturnType<typeof computeCanonicalFingerprint> | null
): TrustDuplicateRisk {
  if (fseDecision.failedRules.includes("duplicate_suspicion")) return "high";
  if (!fingerprint?.isStrongEnoughForAutoSaveDedup) return "medium";
  return "none";
}

export function buildGmailTrustContext(input: {
  organizationId: string;
  supplierName: string;
  documentType: string;
  classification: GmailScanClassification;
  extractedFieldsConfidence?: number;
  hasPdfOrImageAttachment?: boolean;
  visualNeedsReview?: boolean;
  fseDecision: FinancialSanityDecision;
  fingerprint: ReturnType<typeof computeCanonicalFingerprint> | null;
  contextCache?: GmailFinancialSanityContextSessionCache;
}) {
  const supplierHistory = input.contextCache?.getSupplierHistory(input.organizationId, input.supplierName);
  const ocrQuality = Math.max(
    input.classification.confidence,
    input.extractedFieldsConfidence ?? 0
  );
  const attachmentQuality = input.hasPdfOrImageAttachment
    ? input.visualNeedsReview
      ? 0.45
      : 0.9
    : 0.35;

  return {
    documentType: input.documentType,
    duplicateRisk: deriveGmailTrustDuplicateRisk(input.fseDecision, input.fingerprint),
    ocrQuality,
    attachmentQuality,
    supplierHistory: supplierHistory
      ? {
          invoiceCount: supplierHistory.invoiceCount,
          correctionsCount: 0,
        }
      : null,
  };
}

export function runGmailOrgTrustDecision(input: {
  organizationId: string;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  fseDecision: FinancialSanityDecision;
  supplierName: string;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  documentDate: Date;
  documentType: string;
  classification: GmailScanClassification;
  extractedFieldsConfidence?: number;
  hasPdfOrImageAttachment?: boolean;
  visualNeedsReview?: boolean;
  contextCache?: GmailFinancialSanityContextSessionCache;
  gmailMessageId?: string;
  logStep?: (message: string) => void;
}): TrustDecision {
  const trustStartedAt = Date.now();
  if (input.gmailMessageId && input.logStep) {
    input.logStep(`[trust] start message=${input.gmailMessageId}`);
  }

  const fingerprint = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.moneyDecision.selectedAmount,
    documentDate: input.documentDate,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
  });
  const decision = computeTrustDecision({
    fingerprint,
    moneyDecision: input.moneyDecision,
    supplierDecision: input.supplierDecision,
    fseDecision: input.fseDecision,
    context: buildGmailTrustContext({
      organizationId: input.organizationId,
      supplierName: input.supplierName,
      documentType: input.documentType,
      classification: input.classification,
      extractedFieldsConfidence: input.extractedFieldsConfidence,
      hasPdfOrImageAttachment: input.hasPdfOrImageAttachment,
      visualNeedsReview: input.visualNeedsReview,
      fseDecision: input.fseDecision,
      fingerprint,
      contextCache: input.contextCache,
    }),
  });

  if (input.gmailMessageId && input.logStep) {
    input.logStep(
      `[trust] decision message=${input.gmailMessageId} decision=${decision.decision} confidence=${decision.confidence} durationMs=${Date.now() - trustStartedAt}`
    );
  }

  return decision;
}

export function applyTrustReviewGate(input: {
  classification: GmailScanClassification;
  trustDecision: TrustDecision;
}): GmailScanClassification {
  if (input.trustDecision.decision === "BLOCK") {
    const reason = `trust_block:${input.trustDecision.reasonCode}`;
    if (input.classification.reviewStatus === "needs_review") {
      return {
        ...input.classification,
        decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
        confidence: Math.min(input.classification.confidence, input.trustDecision.confidence / 100),
      };
    }
    return {
      ...input.classification,
      reviewStatus: "needs_review",
      decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
      confidence: Math.min(input.classification.confidence, input.trustDecision.confidence / 100),
    };
  }

  if (input.trustDecision.decision !== "NEEDS_REVIEW") {
    return input.classification;
  }

  const reason = `trust_review:${input.trustDecision.reasonCode}`;
  if (input.classification.reviewStatus === "needs_review") {
    return {
      ...input.classification,
      decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
      confidence: Math.min(input.classification.confidence, input.trustDecision.confidence / 100),
    };
  }

  return {
    ...input.classification,
    reviewStatus: "needs_review",
    decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
    confidence: Math.min(input.classification.confidence, input.trustDecision.confidence / 100),
  };
}

export function buildGmailOutcomeContext(input: {
  classification: GmailScanClassification;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  fingerprint: ReturnType<typeof computeCanonicalFingerprint> | null;
  existingScanItem?: { amount: unknown } | null;
  duplicateKey?: string | null;
  businessClassificationReason?: string | null;
  visualReviewReason?: string | null;
  pipelineError?: string | null;
  processingStage?: string | null;
}): OutcomeOptionalContext {
  const existingAmount = Number(input.existingScanItem?.amount);
  const duplicateDetected =
    Boolean(input.existingScanItem) && Number.isFinite(existingAmount) && existingAmount > 0;
  const reviewReason =
    [
      input.classification.reviewStatus === "needs_review" ? input.classification.decisionReason : null,
      input.visualReviewReason,
      input.businessClassificationReason,
    ]
      .filter(Boolean)
      .join("; ") || null;

  return {
    documentType: input.classification.documentType,
    duplicateDetected,
    duplicateMatchIdentity: duplicateDetected
      ? input.fingerprint?.fingerprint ?? input.duplicateKey ?? null
      : null,
    reviewReason,
    pipelineError: input.pipelineError ?? null,
    processingStage: input.processingStage ?? null,
  };
}

export function runGmailOrgOutcomeDecision(input: {
  organizationId: string;
  trustDecision: TrustDecision;
  fseDecision: FinancialSanityDecision;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  supplierName: string;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  documentDate: Date;
  documentType: string;
  classification: GmailScanClassification;
  existingScanItem?: { amount: unknown } | null;
  duplicateKey?: string | null;
  businessClassificationReason?: string | null;
  visualReviewReason?: string | null;
  pipelineError?: string | null;
  processingStage?: string | null;
  gmailMessageId?: string;
  logStep?: (message: string) => void;
}): DocumentOutcome {
  const outcomeStartedAt = Date.now();
  if (input.gmailMessageId && input.logStep) {
    input.logStep(`[outcome] start message=${input.gmailMessageId}`);
  }

  const fingerprint = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.moneyDecision.selectedAmount,
    documentDate: input.documentDate,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
  });
  const outcome = computeDocumentOutcome({
    trustDecision: input.trustDecision,
    fseDecision: input.fseDecision,
    supplierDecision: input.supplierDecision,
    moneyDecision: input.moneyDecision,
    fingerprint,
    context: buildGmailOutcomeContext({
      classification: input.classification,
      supplierDecision: input.supplierDecision,
      moneyDecision: input.moneyDecision,
      fingerprint,
      existingScanItem: input.existingScanItem,
      duplicateKey: input.duplicateKey,
      businessClassificationReason: input.businessClassificationReason,
      visualReviewReason: input.visualReviewReason,
      pipelineError: input.pipelineError,
      processingStage: input.processingStage,
    }),
  });

  if (input.gmailMessageId && input.logStep) {
    input.logStep(
      `[outcome] status message=${input.gmailMessageId} status=${outcome.status} reasonCode=${outcome.reasonCode} durationMs=${Date.now() - outcomeStartedAt}`
    );
  }

  return outcome;
}

export function gmailOutcomeStopsPersistence(status: DocumentOutcomeStatus): boolean {
  return status === "BLOCKED" || status === "ERROR" || status === "DUPLICATE" || status === "NOT_FINANCIAL";
}

export function gmailOutcomeUncertaintyReason(outcome: DocumentOutcome): string {
  return `outcome_${outcome.status}:${outcome.reasonCode}:${outcome.reason}`.slice(0, 500);
}

export function applyOutcomeReviewGate(input: {
  classification: GmailScanClassification;
  documentOutcome: DocumentOutcome;
}): GmailScanClassification {
  if (input.documentOutcome.status === "NEEDS_REVIEW" || input.documentOutcome.status === "BLOCKED") {
    const reason =
      input.documentOutcome.status === "BLOCKED"
        ? `outcome_blocked:${input.documentOutcome.reasonCode}`
        : `outcome_review:${input.documentOutcome.reasonCode}`;
    if (input.classification.reviewStatus === "needs_review") {
      return {
        ...input.classification,
        decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
      };
    }
    return {
      ...input.classification,
      reviewStatus: "needs_review",
      decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
    };
  }

  return input.classification;
}

export function applyFinancialSanityReviewGate(input: {
  classification: GmailScanClassification;
  fseDecision: FinancialSanityDecision;
  amount?: number | null;
  rawOcrText?: string | null;
}): GmailScanClassification {
  const { fseDecision } = input;
  const forceReview =
    fseDecision.overallStatus === "error" ||
    fseDecision.overallStatus === "review" ||
    shouldEscalateFseWarningToReview(fseDecision, {
      amount: input.amount,
      rawOcrText: input.rawOcrText,
    });
  if (!forceReview) {
    return input.classification;
  }

  const reason = `fse_${fseDecision.overallStatus}:${fseDecision.failedRules.join(",") || "none"}`;
  if (input.classification.reviewStatus === "needs_review") {
    return {
      ...input.classification,
      decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
      confidence: Math.min(input.classification.confidence, fseDecision.confidence),
    };
  }
  return {
    ...input.classification,
    reviewStatus: "needs_review",
    decisionReason: `${input.classification.decisionReason}; ${reason}`.slice(0, 500),
    confidence: Math.min(input.classification.confidence, fseDecision.confidence),
  };
}

async function loadGmailFinancialSanityContext(input: {
  organizationId: string;
  supplierName: string;
  fingerprint: string | null;
  amount: number | null;
  documentDate: Date;
  currency: string;
  contextCache?: GmailFinancialSanityContextSessionCache;
}): Promise<FinancialSanityContext> {
  const duplicateFingerprints: string[] = [];
  const duplicateLookups: Promise<void>[] = [];

  if (input.fingerprint) {
    duplicateLookups.push((async () => {
      const duplicate = await prisma.supplierPayment.findFirst({
        where: {
          organizationId: input.organizationId,
          documentFingerprint: input.fingerprint,
        },
        select: { documentFingerprint: true },
      });
      if (duplicate?.documentFingerprint) {
        duplicateFingerprints.push(duplicate.documentFingerprint);
      }
    })());
  }

  if (isUsableSupplierName(input.supplierName) && input.amount != null) {
    const semanticAmount = input.amount;
    const semanticKey = `${input.supplierName}|${Math.abs(semanticAmount)}|${input.documentDate.toISOString().slice(0, 10)}`;
    const dayStart = new Date(input.documentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    duplicateLookups.push((async () => {
      const semanticDuplicate = await prisma.supplierPayment.findFirst({
        where: {
          organizationId: input.organizationId,
          supplier: input.supplierName,
          amount: semanticAmount,
          date: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true },
      });
      if (semanticDuplicate) {
        duplicateFingerprints.push(semanticKey);
      }
    })());
  }

  let supplierHistory: FinancialSanityContext["supplierHistory"] = null;
  const supplierHistoryLookup = (async () => {
    if (!isUsableSupplierName(input.supplierName)) return;
    const cachedHistory = input.contextCache?.getSupplierHistory(input.organizationId, input.supplierName);
    if (cachedHistory !== undefined) {
      supplierHistory = cachedHistory;
      return;
    }
    const payments = await prisma.supplierPayment.findMany({
      where: {
        organizationId: input.organizationId,
        approvalStatus: "approved",
        OR: [{ supplier: input.supplierName }, { supplierName: input.supplierName }],
      },
      select: { amount: true, currency: true, invoiceNumber: true },
      orderBy: { date: "desc" },
      take: 40,
    });
    if (payments.length > 0) {
      const amounts = payments
        .map((payment) => Math.abs(payment.amount))
        .filter((value) => value > 0 && value <= MAX_REASONABLE_FINANCIAL_AMOUNT);
      supplierHistory = {
        invoiceCount: payments.length,
        minAmount: amounts.length > 0 ? Math.min(...amounts) : null,
        maxAmount: amounts.length > 0 ? Math.max(...amounts) : null,
        averageAmount: amounts.length > 0 ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : null,
        typicalCurrency: payments.find((payment) => payment.currency)?.currency ?? input.currency,
        lastInvoiceNumber: payments.find((payment) => payment.invoiceNumber)?.invoiceNumber ?? null,
        recentInvoiceNumbers: payments
          .map((payment) => payment.invoiceNumber)
          .filter((value): value is string => Boolean(value)),
      };
    }
    input.contextCache?.setSupplierHistory(input.organizationId, input.supplierName, supplierHistory);
  })();

  await Promise.all([...duplicateLookups, supplierHistoryLookup]);

  return {
    supplierHistory,
    duplicateFingerprints,
    expectedCurrency: input.currency,
    referenceDate: new Date(),
    vatRate: 0.18,
  };
}

export async function runGmailOrgFinancialSanity(input: {
  organizationId: string;
  supplierDecision: SupplierDecision;
  moneyDecision: MoneyDecision;
  supplierName: string;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  documentDate: Date;
  dueDate: Date | null;
  documentType: string;
  rawOcrText: string;
  gmailMessageId?: string;
  logStep?: (message: string) => void;
  contextCache?: GmailFinancialSanityContextSessionCache;
}): Promise<FinancialSanityDecision> {
  const fseStartedAt = Date.now();
  if (input.gmailMessageId && input.logStep) {
    input.logStep(`[gmail-sync] FSE start message=${input.gmailMessageId}`);
  }
  const fingerprint = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.moneyDecision.selectedAmount,
    documentDate: input.documentDate,
    documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
  });
  const context = await loadGmailFinancialSanityContext({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    fingerprint: fingerprint.fingerprint,
    amount: input.moneyDecision.selectedAmount,
    documentDate: input.documentDate,
    currency: input.moneyDecision.currency,
    contextCache: input.contextCache,
  });
  const decision = computeFinancialSanity({
    organizationId: input.organizationId,
    supplierDecision: input.supplierDecision,
    moneyDecision: input.moneyDecision,
    fingerprint,
    invoiceNumber: input.invoiceNumber,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    currency: input.moneyDecision.currency,
    invoiceData: {
      documentType: mapAnalysisDocumentTypeForAmount(input.documentType),
      rawOcrText: input.rawOcrText,
      extractionSource: "gmail",
    },
    context,
  });
  if (input.gmailMessageId && input.logStep) {
    input.logStep(
      `[gmail-sync] FSE end message=${input.gmailMessageId} durationMs=${Date.now() - fseStartedAt} status=${decision.overallStatus} trust=${decision.trustScore} failed=${decision.failedRules.join(",") || "none"}`
    );
  }
  return decision;
}

type AttachmentInvoiceAnalysisResult =
  | { skipped: true; reason: string; attachmentText: string }
  | { skipped: false; analysis: EmailAnalysis; attachmentText: string };

type GmailDriveLink = {
  type: string;
  link: string;
  filename?: string | null;
  gmailAttachmentId?: string | null;
  mimeType?: string | null;
  fileId?: string | null;
  folderId?: string | null;
  clientFolderId?: string | null;
  supplierFolderId?: string | null;
  folderPath?: string | null;
  supplierName?: string | null;
  invoiceMonth?: number | null;
  invoiceYear?: number | null;
  fileSize?: number | null;
};

const GMAIL_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const CLAUDE_VISION_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

type FinancialSenderDetection =
  | { held: true; reason: string }
  | { held: false; reason: null };

export function classifyGmailScanCandidate(input: {
  subject: string;
  bodyText: string;
  attachmentFilenames: string[];
  analysis: Pick<EmailAnalysis, "documentType" | "confidence" | "paymentRequired">;
  amount: number | null;
  supplierName: string;
  senderName?: string;
  senderEmail?: string;
  senderDomain?: string;
  amountRejectedReason?: string | null;
}): GmailScanClassification {
  const text = `${input.subject}\n${input.bodyText}\n${input.attachmentFilenames.join("\n")}`.toLowerCase();
  const attachmentText = input.attachmentFilenames.join("\n").toLowerCase();
  const hasAttachment = input.attachmentFilenames.length > 0;
  const hasPdf = input.attachmentFilenames.some((filename) => /\.pdf$/i.test(filename));
  const hasImageAttachment = input.attachmentFilenames.some((filename) => /\.(png|jpe?g|heic|heif)$/i.test(filename));
  const keywordMatches = matchedStrongInvoiceTerms(text);
  const municipalCollectionDocument = detectMunicipalCollectionDocument(text);
  const hasInvoice = keywordMatches.length > 0 || municipalCollectionDocument.detected || INVOICE_KEYWORD_PATTERNS.some((pattern) => pattern.test(text)) || /green invoice|greeninvoice|icount|i-count|חשבונית ירוקה/.test(text);
  const hasReceipt = RECEIPT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasPaymentRequest = municipalCollectionDocument.detected || PAYMENT_REQUEST_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasSupplierSignal = SUPPLIER_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasAmount = input.amount !== null;
  const aiType = input.analysis.documentType;
  const aiConfidence = Number.isFinite(input.analysis.confidence) ? input.analysis.confidence : 0;
  const hasSupplier = isUsableSupplierName(input.supplierName);
  const invoiceAttached = hasAttachment && /invoice|tax[-_\s]?invoice|חשבונית|חשבונית\s*מס|חשבונית[-_\s]?מס|greeninvoice|icount|i-count/.test(attachmentText);
  const receiptAttached = hasAttachment && /receipt|קבלה|חשבונית\s*מס\s*קבלה/.test(attachmentText);
  const taxInvoiceDetected = /tax\s+invoice|חשבונית\s*מס/.test(text);
  const supplierPaymentRequestDetected = hasPaymentRequest || (input.analysis.paymentRequired && aiType === "payment_request" && aiConfidence >= 0.72);
  const pdfInvoiceDetected = hasPdf && (
    invoiceAttached ||
    receiptAttached ||
    taxInvoiceDetected ||
    hasInvoice ||
    hasReceipt ||
    supplierPaymentRequestDetected ||
    (hasAmount && hasSupplier)
  );
  const imageInvoiceDetected = hasImageAttachment && (
    invoiceAttached ||
    receiptAttached ||
    taxInvoiceDetected ||
    hasInvoice ||
    hasReceipt ||
    aiType === "invoice" ||
    aiType === "receipt" ||
    aiType === "tax_invoice_receipt" ||
    ((hasAmount || input.analysis.paymentRequired) && aiType !== "other")
  );
  const hasStrictPaymentEvidence = invoiceAttached || receiptAttached || supplierPaymentRequestDetected || taxInvoiceDetected || pdfInvoiceDetected || imageInvoiceDetected;
  const pdfLooksLikeInvoice = pdfInvoiceDetected;
  const hasStrongInvoiceEvidence = hasStrictPaymentEvidence;
  const hasExplicitPaymentEvidence = supplierPaymentRequestDetected;
  const aiInvoiceTrusted = (aiType === "invoice" || aiType === "receipt") && aiConfidence >= 0.72 && hasStrongInvoiceEvidence && (hasAmount || pdfLooksLikeInvoice);
  const aiPaymentTrusted = aiType === "payment_request" && aiConfidence >= 0.72 && hasExplicitPaymentEvidence && hasAmount;
  const personalSenderReason = detectPersonalMessage(text, input.senderEmail, input.senderDomain);
  const block = detectNonInvoiceMessage(text, input.senderEmail, input.senderDomain);

  let documentType: GmailDocumentType = "unknown_needs_review";
  if (!block) {
    if (aiType === "quote" || /quote|proposal|estimate|הצעת\s*מחיר/.test(text)) documentType = "quote";
    else if (aiType === "tax_invoice_receipt" || /חשבונית\s*מס\s*קבלה/.test(text)) documentType = "tax_invoice_receipt";
    else if (hasReceipt || (aiInvoiceTrusted && aiType === "receipt")) documentType = "receipt";
    else if (hasExplicitPaymentEvidence || aiPaymentTrusted) documentType = "payment_request";
    else if (hasInvoice || aiInvoiceTrusted || (imageInvoiceDetected && aiType === "invoice")) documentType = "invoice";
    else if ((hasSupplierSignal || hasAttachment) && (hasAmount || pdfLooksLikeInvoice || aiType !== "other")) documentType = "supplier_message";
  }

  const isRelevant = documentType !== "unknown_needs_review";
  const evidence = [
    block && `blocked:${block}`,
    hasPdf && "attachment found: PDF",
    hasImageAttachment && "attachment found: image",
    hasAttachment && !hasPdf && "attachment found",
    invoiceAttached && "invoice attachment detected",
    receiptAttached && "receipt attachment detected",
    taxInvoiceDetected && "tax invoice detected",
    supplierPaymentRequestDetected && "supplier payment request detected",
    pdfInvoiceDetected && "PDF invoice detected",
    imageInvoiceDetected && "image invoice detected",
    municipalCollectionDocument.detected && "municipal collection document detected",
    hasAmount && "amount found",
    ...keywordMatches.map((keyword) => `keyword matched: ${keyword}`),
    hasReceipt && "keyword matched: receipt",
    hasPaymentRequest && "keyword matched: payment request",
    hasSupplierSignal && "supplier detected",
    aiType !== "other" && aiConfidence >= 0.72 && `ai:${aiType}:${Math.round(aiConfidence * 100)}%`,
  ].filter(Boolean) as string[];

  const confidence = computeInvoiceConfidence({
    blocked: Boolean(block),
    hasStrongInvoiceEvidence,
    pdfLooksLikeInvoice,
    hasAmount,
    hasSupplier: isUsableSupplierName(input.supplierName),
    hasExplicitPaymentEvidence,
    aiConfidence,
    aiType,
    documentType,
  });
  const confidenceScore = confidenceBucket(confidence, evidence.length, documentType);
  const hasInvoiceEvidence = hasStrictPaymentEvidence || confidence >= 0.7;
  const financialSender = detectFinancialSender({
    senderEmail: input.senderEmail,
    senderDomain: input.senderDomain,
    senderName: input.senderName,
    supplierName: input.supplierName,
    subject: input.subject,
    bodyText: input.bodyText,
  });
  const heldForFinancialSender = financialSender.held;
  const autoSaveHoldReasons = [
    block && `blocked non-invoice message: ${block}`,
    personalSenderReason && !hasInvoiceEvidence && `personal email without invoice evidence: ${personalSenderReason}`,
    !(documentType === "invoice" || documentType === "receipt" || documentType === "tax_invoice_receipt" || documentType === "payment_request") && `documentType is ${documentType}`,
    confidence < 0.8 && `confidence below 80% (${Math.round(confidence * 100)}%)`,
    !hasStrictPaymentEvidence && "no strict invoice/payment evidence",
    documentType === "invoice" && !hasStrongInvoiceEvidence && "no strong invoice evidence",
    documentType === "invoice" && input.amountRejectedReason && input.amountRejectedReason,
    documentType === "invoice" && !hasAmount && (input.amountRejectedReason ?? "no valid amount"),
    documentType === "payment_request" && !hasExplicitPaymentEvidence && "no explicit payment request evidence",
    documentType === "payment_request" && !hasAmount && (input.amountRejectedReason ?? "no valid amount"),
    documentType === "payment_request" && !hasAttachment && "payment request without attachment",
  ].filter(Boolean) as string[];
  const canAutoSave = autoSaveHoldReasons.length === 0;
  const reviewStatus = heldForFinancialSender
    ? "needs_review"
    : canAutoSave
      ? "auto_saved"
      : "needs_review";
  const decisionReason = heldForFinancialSender
    ? financialSender.reason
    : canAutoSave
      ? `Auto-saved: ${documentType} confidence=${Math.round(confidence * 100)}%; ${evidence.join("; ")}`
      : `Held for review: confidence is ${confidenceScore}; ${autoSaveHoldReasons.join(" / ")}`;

  return {
    documentType,
    confidenceScore,
    confidence,
    reviewStatus,
    isRelevant,
    decisionReason,
    evidence,
    audit: {
      keywordMatched: keywordMatches,
      attachmentFound: hasAttachment,
      amountFound: hasAmount,
      supplierDetected: hasSupplier,
      blockedReason: block ?? (personalSenderReason && !hasInvoiceEvidence ? personalSenderReason : null),
      invoiceAttached,
      receiptAttached,
      supplierPaymentRequestDetected,
      taxInvoiceDetected,
      pdfInvoiceDetected,
      imageInvoiceDetected,
      strictPaymentEvidence: hasStrictPaymentEvidence,
    },
    heldForFinancialSender,
    financialSenderReason: financialSender.held ? financialSender.reason : null,
  };
}

export function applyBusinessReviewToInvoiceCandidate(input: {
  classification: GmailScanClassification;
  invoiceDetected: boolean;
  analysisDocumentType: EmailAnalysis["documentType"];
  businessClassification: ClassificationResult;
  pipelineAction: PipelineClassificationAction;
}): GmailScanClassification {
  if (!input.invoiceDetected || input.pipelineAction !== "NEEDS_REVIEW") return input.classification;

  const documentType = isInvoiceRecordDocument(input.classification.documentType)
    ? input.classification.documentType
    : normalizeInvoiceDocumentType(input.analysisDocumentType, "invoice");
  const classifierEvidence = `classifier needs review: ${input.businessClassification.reason}`;
  const evidence = input.classification.evidence.includes(classifierEvidence)
    ? input.classification.evidence
    : [...input.classification.evidence, classifierEvidence];

  return {
    ...input.classification,
    documentType,
    reviewStatus: "needs_review",
    isRelevant: true,
    decisionReason: `Held for review: classifier ${input.businessClassification.reason}; ${input.classification.decisionReason}`,
    evidence,
  };
}

function promoteImageInvoiceCandidateForReview(classification: GmailScanClassification, reason: string): GmailScanClassification {
  const documentType = isInvoiceRecordDocument(classification.documentType)
    ? classification.documentType
    : "invoice";
  const evidence = classification.evidence.includes("image invoice OCR candidate")
    ? classification.evidence
    : [...classification.evidence, "image invoice OCR candidate"];
  return {
    ...classification,
    documentType,
    reviewStatus: "needs_review",
    isRelevant: true,
    decisionReason: `Held for review: ${reason}; ${classification.decisionReason}`,
    evidence,
  };
}

function matchedStrongInvoiceTerms(text: string) {
  return STRONG_INVOICE_TERMS.filter((term) => text.includes(term.toLowerCase()));
}

function detectNonInvoiceMessage(text: string, senderEmail?: string, senderDomain?: string) {
  const haystack = [text, senderEmail, senderDomain].filter(Boolean).join("\n");
  return NON_INVOICE_BLOCK_PATTERNS.find(({ pattern }) => pattern.test(haystack))?.label ?? null;
}

function detectPersonalMessage(text: string, senderEmail?: string, senderDomain?: string) {
  const domain = (senderDomain || senderEmail?.split("@")[1] || "").trim().toLowerCase();
  if (PERSONAL_EMAIL_DOMAIN_PATTERN.test(domain)) return `personal sender domain: ${domain}`;
  return PERSONAL_EMAIL_CONTENT_PATTERN.test(text) ? "personal email content" : null;
}

function isPersonalEmailSender(senderEmail?: string | null, senderDomain?: string | null) {
  const domain = (senderDomain || senderEmail?.split("@")[1] || "").trim().toLowerCase();
  return PERSONAL_EMAIL_DOMAIN_PATTERN.test(domain);
}

function computeInvoiceConfidence(input: {
  blocked: boolean;
  hasStrongInvoiceEvidence: boolean;
  pdfLooksLikeInvoice: boolean;
  hasAmount: boolean;
  hasSupplier: boolean;
  hasExplicitPaymentEvidence: boolean;
  aiConfidence: number;
  aiType: string;
  documentType: GmailDocumentType;
}) {
  if (input.blocked || input.documentType === "unknown_needs_review") return 0;
  let score = 0;
  if (input.hasStrongInvoiceEvidence) score += 0.42;
  if (input.pdfLooksLikeInvoice) score += 0.22;
  if (input.hasAmount) score += 0.2;
  if (input.hasSupplier) score += 0.08;
  if (input.hasExplicitPaymentEvidence) score += 0.12;
  if (input.documentType === "payment_request" && input.hasExplicitPaymentEvidence && input.hasAmount) score += 0.35;
  if (input.aiType !== "other") score += Math.min(0.12, Math.max(0, input.aiConfidence) * 0.12);
  return Math.max(0, Math.min(0.99, score));
}

function detectFinancialSender(input: {
  senderEmail?: string;
  senderDomain?: string;
  senderName?: string;
  supplierName?: string;
  subject?: string;
  bodyText?: string;
}): FinancialSenderDetection {
  const values = [input.senderEmail, input.senderDomain]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  const domainMatch = values.some((value) => {
    const domain = value.match(/@([^>\s]+)/)?.[1] ?? value;
    return FINANCIAL_SENDER_DOMAINS.some((financialDomain) => domain.includes(financialDomain));
  });
  if (domainMatch) {
    return { held: true, reason: "Held for review: sender is a financial institution (bank)" };
  }

  const searchableText = [
    input.senderName,
    input.supplierName,
    input.subject,
    input.bodyText,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  const nameMatch = FINANCIAL_INSTITUTION_NAME_PATTERNS.find(({ pattern }) => pattern.test(searchableText));
  if (nameMatch) {
    return {
      held: true,
      reason: `Held for review: financial institution detected by name (${nameMatch.label})`,
    };
  }

  return { held: false, reason: null };
}

export function buildGmailScanDuplicateKey(input: {
  gmailMessageId: string;
  attachmentFilename?: string | null;
  supplierName: string;
  amount: number | null;
  subject?: string | null;
  occurredAt?: Date | null;
}) {
  const subjectKey = (input.subject ?? "")
    .toLowerCase()
    .replace(/\b(?:re|fw|fwd):\s*/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 120);
  const dayKey = input.occurredAt ? input.occurredAt.toISOString().slice(0, 10) : "unknown-day";
  const normalized = [
    (input.attachmentFilename ?? "no-attachment").trim().toLowerCase(),
    canonicalSupplierKey(input.supplierName),
    input.amount === null ? "unknown-amount" : input.amount.toFixed(2),
    subjectKey || input.gmailMessageId,
    dayKey,
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}

function buildInvoiceAttachmentDedupeKey(input: {
  emailMessageId: string;
  gmailMessageId: string;
  attachmentFilename?: string | null;
  gmailAttachmentId?: string | null;
}) {
  const attachmentKey = [
    input.gmailAttachmentId ?? "no-attachment-id",
    (input.attachmentFilename ?? "unnamed").trim().toLowerCase(),
  ].join("|");
  const hash = createHash("sha256")
    .update(`${input.gmailMessageId}|${attachmentKey}`)
    .digest("hex")
    .slice(0, 24);
  return `${input.emailMessageId}:${hash}`;
}

function confidenceBucket(confidence: number, evidenceCount: number, documentType: GmailDocumentType): GmailConfidenceScore {
  if (documentType === "unknown_needs_review") return "low";
  if (confidence >= 0.78 && evidenceCount >= 2) return "high";
  if (confidence >= 0.5 || evidenceCount >= 2) return "medium";
  return "low";
}

function primaryAttachmentFilename(parts: PayloadPart[]) {
  return parts.find((part) => part.filename)?.filename ?? null;
}

function attachmentFilenameForPart(part: PayloadPart) {
  return part.filename?.trim() || attachmentFilenameFromPart(part);
}

function isPdfAttachmentPart(part: PayloadPart) {
  return Boolean(part.body && (part.mimeType === "application/pdf" || /\.pdf$/i.test(part.filename ?? "")));
}

function findDriveLinkForAttachment(
  driveLinks: Array<{
    filename?: string | null;
    gmailAttachmentId?: string | null;
    link: string;
    fileId?: string | null;
    folderId?: string | null;
    clientFolderId?: string | null;
    supplierFolderId?: string | null;
    folderPath?: string | null;
    invoiceMonth?: number | null;
    invoiceYear?: number | null;
  }>,
  part: PayloadPart
) {
  const attachmentId = part.body?.attachmentId ?? null;
  const filename = attachmentFilenameForPart(part);
  return (
    (attachmentId ? driveLinks.find((link) => link.gmailAttachmentId === attachmentId) : null) ??
    (filename ? driveLinks.find((link) => link.filename === filename) : null) ??
    null
  );
}

function gmailMessageLink(gmailMessageId: string) {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(gmailMessageId)}`;
}

const UNKNOWN_SUPPLIER_FALLBACK = "לא זוהה";

function isInvoiceRecordDocument(documentType: GmailDocumentType) {
  return documentType === "invoice" || documentType === "receipt" || documentType === "tax_invoice_receipt";
}

function normalizeInvoiceDocumentType(documentType: EmailAnalysis["documentType"], fallback: GmailDocumentType): GmailDocumentType {
  return documentType === "invoice" || documentType === "receipt" || documentType === "tax_invoice_receipt"
    ? documentType
    : fallback;
}

function isInvoiceScanResultDocument(documentType: string | null | undefined) {
  return documentType === "invoice" || documentType === "receipt" || documentType === "tax_invoice_receipt" || documentType === "payment_request";
}

export function isIncomingSupplierExpenseCandidate(input: {
  source?: string | null;
  senderEmail?: string | null;
  senderDomain?: string | null;
  supplierName: string;
  documentType: GmailDocumentType;
  paymentRequired?: boolean | null;
  ownerEmails?: Set<string> | string[];
}) {
  const paymentDocument =
    input.documentType === "invoice" ||
    input.documentType === "receipt" ||
    input.documentType === "tax_invoice_receipt" ||
    input.documentType === "payment_request";
  if (!paymentDocument) return false;
  if (!isUsableSupplierName(input.supplierName)) return false;

  const source = (input.source ?? "").toLowerCase();
  if (source && source !== "gmail" && source !== "whatsapp_forward") return false;

  const senderEmail = (input.senderEmail ?? "").trim().toLowerCase();
  const senderDomain = (input.senderDomain ?? senderEmail.split("@")[1] ?? "").trim().toLowerCase();
  const owners = new Set(
    [...(input.ownerEmails instanceof Set ? input.ownerEmails : input.ownerEmails ?? [])]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  if (senderEmail && owners.has(senderEmail)) return false;
  if (senderDomain && [...owners].some((email) => email.endsWith(`@${senderDomain}`))) return false;

  return Boolean(senderEmail || senderDomain || input.paymentRequired || paymentDocument);
}

export function buildGmailFinancialPersistencePlan(input: {
  isIncomingSupplierExpense: boolean;
  classification: Pick<GmailScanClassification, "documentType" | "isRelevant" | "reviewStatus">;
  canPersistFinancialRecord: boolean;
  clientId?: string | null;
  supplierPaymentAllowed: boolean;
}) {
  const invoiceRecordDocument = isInvoiceRecordDocument(input.classification.documentType);
  return {
    shouldCreateClientForRelevantEmail:
      input.canPersistFinancialRecord &&
      input.classification.reviewStatus === "auto_saved" &&
      !input.isIncomingSupplierExpense &&
      !input.clientId &&
      input.classification.isRelevant,
    shouldCreateLeadForRelevantEmail:
      input.canPersistFinancialRecord &&
      input.classification.reviewStatus === "auto_saved" &&
      !input.isIncomingSupplierExpense &&
      !input.clientId &&
      input.classification.isRelevant,
    shouldEnsureInvoiceClient:
      input.canPersistFinancialRecord &&
      input.classification.reviewStatus === "auto_saved" &&
      !input.isIncomingSupplierExpense &&
      invoiceRecordDocument &&
      !input.clientId,
    shouldCreateAnalysisTasks:
      input.canPersistFinancialRecord &&
      input.classification.reviewStatus === "auto_saved",
    shouldSaveInvoice:
      !input.isIncomingSupplierExpense &&
      input.canPersistFinancialRecord &&
      Boolean(input.clientId) &&
      invoiceRecordDocument &&
      input.classification.reviewStatus === "auto_saved",
    supplierPaymentsToCreateOrUpdate:
      input.canPersistFinancialRecord && input.supplierPaymentAllowed ? 1 : 0,
  };
}

export function supplierPaymentCreationEligibility(input: {
  classification: GmailScanClassification;
  amount: number | null;
  supplierName: string;
  senderIsOwner?: boolean;
  supplierGate?: SupplierGateSnapshot | null;
  fingerprintGate?: FingerprintGateSnapshot | null;
  duplicateGate?: DuplicateGateSnapshot | null;
}): { allowed: true; reasons: []; persistAsNeedsReview: boolean } | { allowed: false; reasons: string[]; persistAsNeedsReview: false } {
  if (input.duplicateGate && input.duplicateGate.verdict !== "pass") {
    return {
      allowed: false,
      reasons: [input.duplicateGate.reasonCode],
      persistAsNeedsReview: false,
    };
  }

  if (input.fingerprintGate && input.fingerprintGate.verdict !== "pass") {
    return {
      allowed: false,
      reasons: [input.fingerprintGate.reasonCode],
      persistAsNeedsReview: false,
    };
  }

  if (input.supplierGate && input.supplierGate.verdict !== "pass") {
    return {
      allowed: false,
      reasons: [input.supplierGate.reasonCode],
      persistAsNeedsReview: false,
    };
  }

  if (isInvoiceRecordDocument(input.classification.documentType)) {
    if (!isUsableSupplierName(input.supplierName)) {
      return {
        allowed: false,
        reasons: ["supplier.sir_missing"],
        persistAsNeedsReview: false,
      };
    }
    return {
      allowed: true,
      reasons: [],
      persistAsNeedsReview:
        input.senderIsOwner === true ||
        input.classification.reviewStatus !== "auto_saved" ||
        input.classification.confidence < 0.8 ||
        !input.classification.audit.strictPaymentEvidence ||
        input.amount === null,
    };
  }

  const reasons = [
    input.classification.heldForFinancialSender && "held_for_financial_sender",
    input.classification.reviewStatus !== "auto_saved" && "needs_review",
    !input.classification.isRelevant && "not_relevant",
    input.classification.confidence < 0.8 && `confidence_below_80_${Math.round(input.classification.confidence * 100)}%`,
    !["invoice", "receipt", "tax_invoice_receipt", "payment_request"].includes(input.classification.documentType) && `document_type_${input.classification.documentType}`,
    !input.classification.audit.strictPaymentEvidence && "missing_strict_invoice_payment_evidence",
    input.amount === null && "missing_amount",
    !isUsableSupplierName(input.supplierName) && "unknown_or_unusable_supplier",
  ].filter(Boolean) as string[];

  return reasons.length === 0
    ? { allowed: true, reasons: [], persistAsNeedsReview: false }
    : { allowed: false, reasons, persistAsNeedsReview: false };
}

export type ExtractedHebrewInvoiceFields = {
  amount: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  confidence: number;
  reasons: string[];
};

export function extractHebrewInvoiceFieldsFromText(text: string): ExtractedHebrewInvoiceFields {
  const normalized = normalizeExtractionText(text);
  const amountResult = extractInvoiceAmount(normalized);
  const invoiceNumber = extractInvoiceNumber(normalized);
  const invoiceDate = extractDateNearLabels(normalized, [
    /תאריך\s+חשבונית/u,
    /תאריך\s+הפקה/u,
    /תאריך\s+מסמך/u,
    /תאריך/u,
    /invoice\s+date/i,
    /date/i,
  ]);
  const dueDate = extractDateNearLabels(normalized, [
    /מועד\s+תשלום/u,
    /לתשלום\s+עד/u,
    /תשלום\s+עד/u,
    /תאריך\s+לתשלום/u,
    /due\s+date/i,
    /payment\s+due/i,
  ]);
  const reasons = [
    amountResult.amount !== null ? "amount_found" : amountResult.rejectedReason ?? "amount_not_found",
    invoiceNumber ? "invoice_number_found" : "invoice_number_not_found",
    invoiceDate ? "invoice_date_found" : "invoice_date_not_found",
    dueDate ? "due_date_found" : "due_date_not_found",
  ];
  const score =
    (amountResult.amount !== null ? 0.42 : 0) +
    (invoiceNumber ? 0.2 : 0) +
    (invoiceDate ? 0.2 : 0) +
    (dueDate ? 0.18 : 0);

  return {
    amount: amountResult.amount,
    invoiceNumber,
    invoiceDate,
    dueDate,
    confidence: Math.min(0.99, Number(score.toFixed(2))),
    reasons,
  };
}

function normalizeExtractionText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״׳]/g, "\"")
    .replace(/[־‐‑‒–—_]+/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractInvoiceNumber(text: string) {
  const patterns = [
    /(?:מספר\s+חשבונית|חשבונית\s*(?:מס|מספר)?|חשבונית\s+מס|מסמך\s+מספר|invoice\s*(?:no\.?|number|#)?|receipt\s*(?:no\.?|number|#)?|מספר)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/iu,
    /(?:מספר\s+חשבון|חשבון)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/iu,
    /\b(?:inv|rcpt)[-_\s]+([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeInvoiceNumberCandidate(match?.[1] ?? "");
    if (candidate) return candidate;
  }
  return null;
}

function normalizeInvoiceNumberCandidate(value: string) {
  const cleaned = value.replace(/[.,;:]+$/, "").trim().slice(0, 80);
  if (!cleaned) return null;
  if (/^(?:number|invoice|receipt|no|מספר|חשבונית|חשבון|קבלה)$/iu.test(cleaned)) return null;
  if (!/[0-9]/.test(cleaned) && cleaned.length < 4) return null;
  return cleaned;
}

function extractDateNearLabels(text: string, labels: RegExp[]) {
  const datePattern = /([0-3]?\d[./-][01]?\d[./-](?:20)?\d{2}|\d{4}-[01]\d-[0-3]\d)/u;
  for (const label of labels) {
    label.lastIndex = 0;
    const match = text.match(label);
    if (!match || match.index == null) continue;
    const windowText = text.slice(match.index, Math.min(text.length, match.index + 90));
    const date = windowText.match(datePattern)?.[1];
    const parsed = normalizeExtractedDate(date);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeExtractedDate(value: string | null | undefined) {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDateIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parts = value.split(/[./-]/).map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return validDateIso(year, month, day);
}

function validDateIso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return date.toISOString().slice(0, 10);
}

export async function diagnoseGmailListingForOrganization(
  organizationId: string,
  options: { daysBack?: number; maxMessages?: number; scanAllMail?: boolean } = {}
) {
  const { gmail } = await getGoogleClients(organizationId);
  const listing = await listCandidateMessages(
    gmail,
    options.daysBack ?? 90,
    options.maxMessages ?? MAX_MESSAGES_PER_RESCAN,
    undefined,
    { scanAllMail: options.scanAllMail ?? true }
  );
  return listing.diagnostics;
}

async function listFastCandidateMessages(
  gmail: GmailClient,
  maxMessages = MAX_MESSAGES_PER_FAST_SCAN,
  options: { scanAllMail?: boolean } = {}
): Promise<{ messages: GmailMessageRef[]; diagnostics: GmailListingDiagnostics }> {
  const byId = new Map<string, GmailMessageRef>();
  const dateFilter = FAST_SCAN_DATE_FILTER;
  const queries = buildFastScanQueries(options);
  let totalPagesScanned = 0;
  let totalMessagesSeen = 0;
  let totalNextPageTokenUses = 0;
  const queryDiagnostics: GmailListingDiagnostics["queries"] = [];

  for (const q of queries) {
    console.log(`[gmail-sync] FAST_SCAN_STARTED query="${q}" maxMessages=${maxMessages}`);
    let pageToken: string | undefined;
    let queryPages = 0;
    let queryMessagesSeen = 0;
    let queryNextPageTokensSeen = 0;
    do {
      const remaining = maxMessages - byId.size;
      if (remaining <= 0) break;
      queryPages++;
      totalPagesScanned++;
      const result = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: Math.min(MAX_MESSAGES_PER_FAST_SCAN, remaining),
        pageToken,
      });

      const pageMessages = result.data.messages ?? [];
      queryMessagesSeen += pageMessages.length;
      totalMessagesSeen += pageMessages.length;
      for (const message of pageMessages) {
        if (!message.id) continue;
        if (byId.has(message.id)) {
          console.log(`[gmail-sync] FAST_SCAN_SKIPPED_DUPLICATE message=${message.id} reason=fast_query_duplicate`);
          continue;
        }
        byId.set(message.id, message);
      }
      if (result.data.nextPageToken) {
        queryNextPageTokensSeen++;
        totalNextPageTokenUses++;
      }
      pageToken = result.data.nextPageToken ?? undefined;
    } while (pageToken && byId.size < maxMessages);
    queryDiagnostics.push({
      query: q,
      pagesProcessed: queryPages,
      messagesSeen: queryMessagesSeen,
      uniqueMessagesAfterQuery: byId.size,
      nextPageTokensSeen: queryNextPageTokensSeen,
      stoppedBecauseMaxReached: byId.size >= maxMessages,
    });
  }

  const messages = [...byId.values()].slice(0, maxMessages);
  return {
    messages,
    diagnostics: {
      requestedDaysBack: 0,
      dateFilter,
      maxMessages,
      scanAllMail: Boolean(options.scanAllMail),
      totalGmailMessagesFound: byId.size,
      pagesProcessed: totalPagesScanned,
      messagesProcessed: messages.length,
      nextPageTokenUses: totalNextPageTokenUses,
      queries: queryDiagnostics,
    },
  };
}

async function listCandidateMessages(
  gmail: GmailClient,
  daysBack: number,
  maxMessages = MAX_MESSAGES_PER_SYNC,
  since?: Date,
  options: { scanAllMail?: boolean } = {}
): Promise<{ messages: GmailMessageRef[]; diagnostics: GmailListingDiagnostics }> {
  const byId = new Map<string, GmailMessageRef>();
  const safeDaysBack = Math.max(1, Math.ceil(daysBack));
  const dateFilter = since
    ? `after:${formatGmailSearchDate(since)}`
    : `newer_than:${safeDaysBack}d`;
  const keywordOr = "{invoice receipt payment \"payment request\" חשבונית קבלה תשלום \"דרישת תשלום\"}";
  const excludeQuery = options.scanAllMail ? "-in:spam -in:trash" : GMAIL_EXCLUDE_QUERY;
  let totalPagesScanned = 0;
  let totalMessagesSeen = 0;
  let totalNextPageTokenUses = 0;
  const queryDiagnostics: GmailListingDiagnostics["queries"] = [];
  const queries = options.scanAllMail
    ? [`${dateFilter} ${excludeQuery}`]
    : [
        `${dateFilter} has:attachment ${keywordOr} ${excludeQuery}`,
        `${dateFilter} ${keywordOr} ${excludeQuery}`,
        `${dateFilter} {${SUPPLIER_KEYWORDS.map((keyword) => keyword.includes(" ") ? `"${keyword}"` : keyword).join(" ")}} ${excludeQuery}`,
      ];

  for (const q of queries) {
    console.log(`[gmail-sync] Searching Gmail query="${q}" maxMessages=${maxMessages}`);
    let pageToken: string | undefined;
    let queryPages = 0;
    let queryMessagesSeen = 0;
    let queryNextPageTokensSeen = 0;
    do {
      const remaining = maxMessages - byId.size;
      if (remaining <= 0) break;
      queryPages++;
      totalPagesScanned++;
      const result = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: Math.min(100, remaining),
        pageToken,
      });

      const pageMessages = result.data.messages ?? [];
      queryMessagesSeen += pageMessages.length;
      totalMessagesSeen += pageMessages.length;
      console.log(`[gmail-sync] Gmail page query="${q}" page=${queryPages} messages=${pageMessages.length} uniqueSoFar=${byId.size} nextPage=${Boolean(result.data.nextPageToken)}`);
      for (const message of pageMessages) {
        if (message.id && !byId.has(message.id)) {
          byId.set(message.id, message);
        }
      }
      if (result.data.nextPageToken) {
        queryNextPageTokensSeen++;
        totalNextPageTokenUses++;
      }
      pageToken = result.data.nextPageToken ?? undefined;
    } while (pageToken && byId.size < maxMessages);
    queryDiagnostics.push({
      query: q,
      pagesProcessed: queryPages,
      messagesSeen: queryMessagesSeen,
      uniqueMessagesAfterQuery: byId.size,
      nextPageTokensSeen: queryNextPageTokensSeen,
      stoppedBecauseMaxReached: byId.size >= maxMessages,
    });
    console.log(`[gmail-sync] Gmail query complete pages=${queryPages} messagesSeen=${queryMessagesSeen} uniqueTotal=${byId.size}`);
  }

  console.log(`[gmail-sync] Gmail list returned ${byId.size} candidate messages pagesScanned=${totalPagesScanned} messagesSeen=${totalMessagesSeen} maxMessages=${maxMessages}`);
  const messages = [...byId.values()].slice(0, maxMessages);
  return {
    messages,
    diagnostics: {
      requestedDaysBack: safeDaysBack,
      dateFilter,
      maxMessages,
      scanAllMail: Boolean(options.scanAllMail),
      totalGmailMessagesFound: byId.size,
      pagesProcessed: totalPagesScanned,
      messagesProcessed: messages.length,
      nextPageTokenUses: totalNextPageTokenUses,
      queries: queryDiagnostics,
    },
  };
}

function listingDiagnosticsWindowTruncated(diagnostics: GmailListingDiagnostics) {
  return diagnostics.queries.some((query) => query.stoppedBecauseMaxReached);
}

function formatGmailSearchDate(date: Date) {
  const safeDate = new Date(date.getTime() - 60 * 60 * 1000);
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(safeDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isRetryableError(err)) break;
      console.warn(`${label} attempt=${attempt} reason="${err instanceof Error ? err.message : String(err)}"`);
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function isRetryableError(err: unknown) {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const status = typeof err === "object" && err !== null && "code" in err ? Number((err as { code?: unknown }).code) : 0;
  return status === 429 || status >= 500 || message.includes("timeout") || message.includes("rate") || message.includes("temporarily") || message.includes("socket");
}

function isInsufficientScopeError(err: unknown) {
  const candidate = err as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: unknown };
    errors?: unknown;
  };
  const status = Number(candidate.status ?? candidate.code ?? candidate.response?.status ?? 0);
  const text = JSON.stringify({
    message: err instanceof Error ? err.message : candidate.message,
    data: candidate.response?.data,
    errors: candidate.errors,
  }).toLowerCase();
  return status === 403 && (text.includes("insufficient_scope") || text.includes("insufficient") || text.includes("scope"));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function saveScanProgress(logId: string, data: {
  emailsProcessed: number;
  emailsSaved?: number;
  invoicesFound?: number;
  paymentsCreated: number;
  tasksCreated: number;
  driveUploaded?: number;
  sheetsUpdated?: number;
  errorsCount?: number;
}) {
  await prisma.syncLog.update({
    where: { id: logId },
    data,
  });
}

export function collectAttachmentParts(payload?: PayloadPart): PayloadPart[] {
  const out: PayloadPart[] = [];
  if (!payload) return out;
  if (isAttachmentPayloadPart(payload)) out.push(payload);
  for (const p of payload.parts ?? []) out.push(...collectAttachmentParts(p));
  return out;
}

function isAttachmentPayloadPart(part: PayloadPart) {
  const filename = part.filename?.trim();
  const disposition = part.headers
    ?.find((header) => header.name?.toLowerCase() === "content-disposition")
    ?.value?.toLowerCase() ?? "";
  const contentId = part.headers
    ?.find((header) => header.name?.toLowerCase() === "content-id")
    ?.value?.trim();
  const hasLeafBody = Boolean(part.body?.attachmentId || part.body?.data) && !part.parts?.length;
  return Boolean(
    filename ||
    disposition.includes("attachment") ||
    (hasLeafBody && (isInvoiceImageAttachmentPart(part) || Boolean(contentId) || disposition.includes("inline"))) ||
    (part.body?.data && filename)
  );
}

export function isInvoiceImageAttachmentPart(part: PayloadPart) {
  return Boolean(part.body && imageMimeTypeForPart(part));
}

function imageMimeTypeForPart(part: PayloadPart) {
  const mimeType = normalizeImageMimeType(part.mimeType);
  if (mimeType) return mimeType;
  const filename = part.filename ?? attachmentFilenameFromHeaders(part);
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.heic$/i.test(filename)) return "image/heic";
  if (/\.heif$/i.test(filename)) return "image/heif";
  return null;
}

function normalizeImageMimeType(mimeType?: string | null) {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!GMAIL_IMAGE_MIME_TYPES.has(normalized)) return null;
  if (normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  return normalized;
}

function isClaudeVisionSupportedImageMime(mimeType: string | null) {
  return Boolean(mimeType && CLAUDE_VISION_IMAGE_MIME_TYPES.has(mimeType));
}

function isInlineAttachmentPart(part: PayloadPart) {
  const disposition = part.headers
    ?.find((header) => header.name?.toLowerCase() === "content-disposition")
    ?.value?.toLowerCase() ?? "";
  return disposition.includes("inline");
}

async function persistAttachmentMetadata(emailMessageId: string, parts: PayloadPart[]) {
  for (const part of parts) {
    const filename = part.filename?.trim() || attachmentFilenameFromPart(part);
    const attachmentId = part.body?.attachmentId ?? null;
    const existing = attachmentId
      ? await prisma.emailAttachment.findFirst({
          where: { emailMessageId, gmailAttachmentId: attachmentId },
        })
      : filename
        ? await prisma.emailAttachment.findFirst({
            where: { emailMessageId, filename },
          })
        : null;
    if (existing) {
      await prisma.emailAttachment.update({
        where: { id: existing.id },
        data: {
          filename,
          mimeType: part.mimeType ?? existing.mimeType,
          gmailAttachmentId: attachmentId ?? existing.gmailAttachmentId,
        },
      });
      continue;
    }
    await prisma.emailAttachment.create({
      data: {
        emailMessageId,
        filename,
        mimeType: part.mimeType ?? undefined,
        gmailAttachmentId: attachmentId ?? undefined,
      },
    });
  }
}

function attachmentFilenameFromPart(part: PayloadPart) {
  const headerFilename = attachmentFilenameFromHeaders(part);
  if (headerFilename) return headerFilename;
  const extension = mimeExtension(part.mimeType);
  return `attachment-${createHash("sha1").update(JSON.stringify(part.body ?? {})).digest("hex").slice(0, 8)}${extension}`;
}

function attachmentFilenameFromHeaders(part: PayloadPart) {
  const headers = part.headers ?? [];
  for (const headerName of ["content-disposition", "content-type"]) {
    const headerValue = headers.find((header) => header.name?.toLowerCase() === headerName)?.value ?? "";
    const match = headerValue.match(/(?:filename|name)\*?=(?:UTF-8''|")?([^";]+)"?/i);
    if (match?.[1]) return decodeMimeHeader(decodeURIComponentSafe(match[1].trim())).trim();
  }
  return "";
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mimeExtension(mimeType?: string | null) {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg" || normalized === "image/jpg" || normalized === "image/pjpeg") return ".jpg";
  if (normalized === "image/heic") return ".heic";
  if (normalized === "image/heif") return ".heif";
  if (normalized === "image/webp") return ".webp";
  return "";
}

function extractBody(payload?: PayloadPart): string {
  if (!payload) return "";
  const chunks: string[] = [];
  collectBodyText(payload, chunks);
  return chunks.join("\n").trim();
}

function collectBodyText(payload: PayloadPart, chunks: string[]) {
  if (payload.body?.data && (payload.mimeType === "text/plain" || payload.mimeType === "text/html")) {
    const decoded = decodeGmailAttachment(payload.body.data).toString("utf8");
    chunks.push(payload.mimeType === "text/html" ? stripHtml(decoded) : decoded);
  }
  for (const p of payload.parts ?? []) collectBodyText(p, chunks);
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

function decodeGmailAttachment(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function markEmailAttachmentDriveStatus(input: {
  emailMessageId: string;
  filename: string;
  mimeType?: string | null;
  gmailAttachmentId?: string | null;
  driveUploadStatus: "uploaded" | "pending_retry" | "not_required";
}) {
  const existing = input.gmailAttachmentId
    ? await prisma.emailAttachment.findFirst({
        where: { emailMessageId: input.emailMessageId, gmailAttachmentId: input.gmailAttachmentId },
      })
    : await prisma.emailAttachment.findFirst({
        where: { emailMessageId: input.emailMessageId, filename: input.filename },
      });
  if (existing) {
    return prisma.emailAttachment.update({
      where: { id: existing.id },
      data: {
        filename: input.filename,
        mimeType: input.mimeType ?? existing.mimeType,
        gmailAttachmentId: input.gmailAttachmentId ?? existing.gmailAttachmentId,
        driveUploadStatus: input.driveUploadStatus,
      },
    });
  }
  return prisma.emailAttachment.create({
    data: {
      emailMessageId: input.emailMessageId,
      filename: input.filename,
      mimeType: input.mimeType ?? undefined,
      gmailAttachmentId: input.gmailAttachmentId ?? undefined,
      driveUploadStatus: input.driveUploadStatus,
    },
  });
}

function shortDriveFailureReason(err: unknown) {
  return (err instanceof Error ? err.message : String(err))
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, 80) || "unknown";
}

function decodeMimeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_match, charset: string, encoding: string, encoded: string) => {
    try {
      const normalizedCharset = charset.toLowerCase();
      if (!["utf-8", "utf8", "iso-8859-8", "windows-1255"].includes(normalizedCharset)) return encoded;
      if (encoding.toLowerCase() === "b") {
        return Buffer.from(encoded, "base64").toString("utf8");
      }
      const quoted = encoded
        .replace(/_/g, " ")
        .replace(/=([0-9a-f]{2})/gi, (_hex: string, byte: string) => String.fromCharCode(parseInt(byte, 16)));
      return Buffer.from(quoted, "binary").toString("utf8");
    } catch {
      return value;
    }
  });
}

async function extractPdfTextFromParts(gmail: GmailClient, messageId: string, parts: PayloadPart[]) {
  const pdfParts = parts.filter(isPdfAttachmentPart);
  const texts: string[] = [];
  for (const part of pdfParts) {
    try {
      const text = await extractPdfTextFromPart(gmail, messageId, part);
      if (text) texts.push(text);
    } catch (err) {
      console.warn("[gmail-sync] PDF text extraction failed", err instanceof Error ? err.message : String(err));
    }
  }
  return texts.join("\n\n");
}

async function extractPdfTextFromPart(gmail: GmailClient, messageId: string, part: PayloadPart) {
  let parser: { getText(): Promise<{ text?: string }>; destroy(): Promise<void> } | null = null;
  try {
    const data = await attachmentData(gmail, messageId, part);
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: new Uint8Array(decodeGmailAttachment(data)) });
    const parsed = await parser.getText();
    return parsed.text?.trim() ?? "";
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

async function analyzeInvoiceAttachmentForEmail(input: {
  gmail: GmailClient;
  gmailMessageId: string;
  part: PayloadPart;
  subject: string;
  bodyText: string;
  sender: string;
}): Promise<AttachmentInvoiceAnalysisResult> {
  const imageMimeType = imageMimeTypeForPart(input.part);
  if (imageMimeType) {
    const data = await attachmentData(input.gmail, input.gmailMessageId, input.part);
    const buffer = decodeGmailAttachment(data);
    let result;
    try {
      result = await analyzeInvoiceFile({
        fileBase64: buffer.toString("base64"),
        mimeType: imageMimeType,
        filename: input.part.filename ?? undefined,
      });
    } catch (err) {
      if (!isClaudeVisionSupportedImageMime(imageMimeType)) {
        return {
          skipped: true as const,
          reason: `unsupported_image_mime_${imageMimeType}`,
          attachmentText: `filename=${attachmentFilenameForPart(input.part)} documentType=invoice amount=unknown invoiceNumber=unknown currency=ILS imageOcrUnavailable=true unsupportedMime=${imageMimeType}`,
        };
      }
      throw err;
    }
    const attachmentText = buildImageAttachmentOcrText(input.part, result);
    if (result.ocrText) {
      console.log(`[gmail-sync] OCR_TEXT_EXTRACTED message=${input.gmailMessageId} file="${attachmentFilenameForPart(input.part)}" source=tesseract_heb_eng confidence=${result.ocrConfidence ?? "unknown"} text="${truncateForLog(result.ocrText)}"`);
    }
    return {
      skipped: false as const,
      attachmentText,
      analysis: {
        supplier: result.supplier,
        supplierTaxId: result.supplierTaxId ?? null,
        amount: result.amount,
        amountBeforeVat: result.amountBeforeVat ?? null,
        vatAmount: result.vatAmount ?? null,
        totalAmount: result.totalAmount ?? result.amount,
        currency: result.currency,
        documentType: result.documentType ?? "other",
        paymentRequired: result.paymentRequired ?? result.documentType !== "receipt",
        dueDate: result.dueDate ?? null,
        invoiceDate: result.date,
        invoiceNumber: result.invoiceNumber,
        tasks: [],
        confidence: isInvoiceScanResultDocument(result.documentType) ? 0.82 : 0.55,
      },
    };
  }

  const attachmentText = await extractPdfTextFromPart(input.gmail, input.gmailMessageId, input.part).catch((err) => {
    console.warn(`[gmail-sync] per-PDF extraction failed message=${input.gmailMessageId} file="${input.part.filename ?? "unnamed"}"`, err instanceof Error ? err.message : String(err));
    return "";
  });
  const body = [
    input.bodyText,
    attachmentText && `--- PDF ATTACHMENT TEXT ---\n${attachmentText}`,
  ].filter(Boolean).join("\n\n");
  const analysis = await analyzeEmailContent({
    subject: input.subject,
    body,
    filenames: [input.part.filename].filter(Boolean) as string[],
    sender: input.sender,
  });
  return { skipped: false as const, analysis, attachmentText };
}

function buildImageAttachmentOcrText(part: PayloadPart, result: Awaited<ReturnType<typeof analyzeInvoiceFile>>) {
  return [
    `filename=${attachmentFilenameForPart(part)}`,
    `documentType=${result.documentType ?? "other"}`,
    `supplier=${result.supplier}`,
    `supplierTaxId=${result.supplierTaxId ?? "unknown"}`,
    `amount=${result.totalAmount ?? result.amount ?? "unknown"}`,
    `date=${result.date ?? "unknown"}`,
    `dueDate=${result.dueDate ?? "unknown"}`,
    `invoiceNumber=${result.invoiceNumber ?? "unknown"}`,
    `currency=${result.currency}`,
    `paymentRequired=${result.paymentRequired ?? "unknown"}`,
    result.ocrText ? `rawOcrText=${result.ocrText.slice(0, 3000)}` : "",
  ].filter(Boolean).join(" ");
}

async function extractVisualAttachmentHints(
  gmail: GmailClient,
  messageId: string,
  parts: PayloadPart[],
  sender: string,
  logStep: (message: string) => void,
  ownerEmails: Set<string>
) {
  const visualParts = parts.filter(isInvoiceImageAttachmentPart);
  const hints: string[] = [];
  let invoiceCandidateFound = false;
  let needsReview = false;
  let reviewReason = "image invoice OCR candidate";
  for (const part of visualParts) {
    const filename = attachmentFilenameForPart(part);
    const imageMimeType = imageMimeTypeForPart(part);
    try {
      const data = await attachmentData(gmail, messageId, part);
      const buffer = decodeGmailAttachment(data);
      logStep(`[gmail-sync] OCR_STARTED IMAGE_OCR_STARTED message=${messageId} file="${filename}" mime=${imageMimeType ?? part.mimeType ?? "unknown"} bytes=${buffer.length} preprocessing=sharp_auto_rotate_crop_contrast_shadow_sharpen tesseract=heb+eng`);
      const { analyzeInvoiceFile } = await import("./claude.js");
      const result = await analyzeInvoiceFile({
        fileBase64: buffer.toString("base64"),
        mimeType: imageMimeType ?? "image/jpeg",
        filename: part.filename ?? undefined,
      });
      if (result.ocrText) {
        logStep(`[gmail-sync] OCR_TEXT_EXTRACTED message=${messageId} file="${filename}" source=tesseract_heb_eng confidence=${result.ocrConfidence ?? "unknown"} text="${truncateForLog(result.ocrText)}"`);
      }
      const keywordSupplier = detectSupplierKeyword(`${result.ocrText ?? ""}\n${result.supplier}`);
      const amount = normalizeDetectedAmount(result.totalAmount ?? result.amount);
      const hasSupplier = isUsableSupplierName(result.supplier, ownerEmails) || Boolean(keywordSupplier);
      const hasInvoiceNumber = Boolean(result.invoiceNumber?.trim());
      const isInvoiceCandidate = isInvoiceScanResultDocument(result.documentType) || amount !== null || hasInvoiceNumber || (hasSupplier && result.paymentRequired === true);
      const uncertain = isInvoiceCandidate && (amount === null || (!hasSupplier && !hasInvoiceNumber));
      invoiceCandidateFound ||= isInvoiceCandidate;
      needsReview ||= uncertain;
      if (uncertain) reviewReason = `image OCR uncertain: amount=${amount ?? "missing"} supplier=${hasSupplier ? "present" : "missing"} invoiceNumber=${hasInvoiceNumber ? "present" : "missing"}`;
      logStep(`[gmail-sync] OCR_FINISHED IMAGE_OCR_FINISHED message=${messageId} file="${filename}" documentType=${result.documentType ?? "other"} supplier="${keywordSupplier?.supplierName ?? result.supplier}" supplierConfidence=${keywordSupplier?.confidence ?? (hasSupplier ? 0.82 : 0.1)} amount=${amount ?? "unknown"} invoiceNumber=${result.invoiceNumber ?? "unknown"} invoiceCandidate=${isInvoiceCandidate} needsReview=${uncertain}`);
      hints.push(buildImageAttachmentOcrText(part, {
        ...result,
        supplier: keywordSupplier?.supplierName ?? result.supplier,
      }));
    } catch (err) {
      logStep(`[gmail-sync] OCR_FINISHED image message=${messageId} file="${filename}" status=error`);
      console.warn(`[gmail-sync] Image OCR/vision failed message=${messageId} sender="${sender}" file="${part.filename ?? "image"}"`, err instanceof Error ? err.message : String(err));
      if (!isClaudeVisionSupportedImageMime(imageMimeType)) {
        invoiceCandidateFound = true;
        needsReview = true;
        reviewReason = `image OCR unavailable: unsupported MIME ${imageMimeType ?? part.mimeType ?? "unknown"}`;
        hints.push(`filename=${filename} documentType=invoice supplier=unknown amount=unknown date=unknown invoiceNumber=unknown currency=ILS paymentRequired=unknown imageOcrUnavailable=true unsupportedMime=${imageMimeType ?? part.mimeType ?? "unknown"}`);
      }
    }
  }
  return { text: hints.join("\n"), invoiceCandidateFound, needsReview, reviewReason };
}

async function attachmentData(gmail: GmailClient, messageId: string, part: PayloadPart) {
  if (part.body?.data) return part.body.data;
  if (!part.body?.attachmentId) throw new Error(`Attachment ${part.filename ?? "unnamed"} is missing attachmentId and inline data`);
  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: part.body.attachmentId,
  });
  return attachment.data.data ?? "";
}

function parseSender(from: string) {
  const email = (from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const name = normalizeSupplierName(from
    .replace(/<[^>]+>/g, "")
    .replace(/["']/g, "")
    .trim());
  return { email, domain, name };
}

function normalizeSupplierName(value: string) {
  const cleaned = value
    .replace(/<[^>]+>/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?|support|no.?reply|noreply)\b/gi, " ")
    .replace(/\b(?:ltd|limited|inc|llc|corp|company|co)\b\.?/gi, " ")
    .replace(/\b(?:בע\"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, " ")
    .replace(/[|:;,\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || value.trim() || "Unknown supplier";
}

function truncateForLog(text: string, limit = 900) {
  return text.replace(/\s+/g, " ").slice(0, limit).replace(/"/g, "'");
}

type SupplierMetadata = {
  name: string;
  taxId: string | null;
  confidence: number;
  source: "keyword" | "document" | "ai" | "known_supplier" | "sender_display" | "domain" | "unknown" | "sir";
  keyword?: string | null;
  decision: SupplierDecision;
};

export function resolveSupplierMetadata(input: {
  analysisSupplier?: string | null;
  analysisSupplierTaxId?: string | null;
  bodyText: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  ownerEmails: Set<string>;
  knownSupplierNames: Map<string, string>;
  ocrKeywordMatch?: ReturnType<typeof classifyOcrSupplierText> | null;
  logStep?: (message: string) => void;
}): SupplierMetadata {
  const taxId = input.analysisSupplierTaxId || extractSupplierTaxId(input.bodyText);
  const supplierCandidates = buildAnalysisSupplierCandidates({
    supplier: input.analysisSupplier,
    supplierTaxId: taxId,
    source: "claude_email",
    aiConfidence: taxId ? 0.88 : 0.8,
  });

  const documentSupplier = extractSupplierFromDocument(input.bodyText, input.ownerEmails);
  if (documentSupplier) {
    supplierCandidates.push(buildDocumentLabelSupplierCandidate({
      supplier: documentSupplier,
      vatNumber: taxId,
      confidence: taxId ? 0.98 : 0.92,
    }));
  }

  const keywordSupplier = input.ocrKeywordMatch ?? detectSupplierKeyword(`${input.bodyText}\n${input.analysisSupplier ?? ""}`);
  if (keywordSupplier) {
    supplierCandidates.push(buildOcrKeywordSupplierCandidate({
      supplier: keywordSupplier.supplierName,
      keyword: keywordSupplier.keyword,
      confidence: keywordSupplier.confidence,
    }));
  }

  supplierCandidates.push(...buildSenderSupplierCandidates({
    senderDisplayName: input.senderName,
    senderDomain: input.senderDomain,
  }));

  const knownRegistryEntries = buildKnownSupplierRegistryEntries(input.knownSupplierNames);
  const historicalNames = new Set<string>();
  const knownCandidates = [input.analysisSupplier, documentSupplier, keywordSupplier?.supplierName];
  for (const knownName of knownCandidates) {
    const key = knownName ? canonicalSupplierKey(knownName) : "";
    if (!key) continue;
    const historical = input.knownSupplierNames.get(key);
    if (!historical || historicalNames.has(historical)) continue;
    historicalNames.add(historical);
    supplierCandidates.push(buildHistoricalSupplierCandidate({
      supplier: historical,
      vatNumber: taxId,
      priorInvoiceCount: 3,
    }));
  }

  const decision = computeCanonicalSupplier({
    organizationId: "gmail-sync",
    channel: "gmail",
    candidates: supplierCandidates,
    registry: knownRegistryEntries,
    ownerEmails: input.ownerEmails,
  });

  input.logStep?.(
    `[gmail-sync] SIR_DECISION status=${decision.status} supplier="${decision.supplierName ?? "none"}" reasonCode=${decision.reasonCode} confidence=${decision.confidence.toFixed(2)}`
  );

  if (decision.status !== "resolved" || !decision.supplierName || !isUsableSupplierName(decision.supplierName, input.ownerEmails)) {
    return {
      name: UNKNOWN_SUPPLIER_FALLBACK,
      taxId: normalizeSupplierTaxId(taxId),
      confidence: Math.min(decision.confidence, 0.2),
      source: "unknown",
      keyword: keywordSupplier?.keyword ?? null,
      decision,
    };
  }

  const resolvedSource = decision.reasonCode === "VAT_REGISTRY"
    ? "document"
    : decision.reasonCode === "OCR_KEYWORD"
      ? "keyword"
      : decision.reasonCode === "AI_EXTRACTED"
        ? "ai"
        : decision.reasonCode === "HISTORICAL_MATCH" || decision.reasonCode === "BRAND_ALIAS"
          ? "known_supplier"
          : "sir";

  return withKnownSupplierName({
    name: decision.supplierName,
    taxId: normalizeSupplierTaxId(decision.vatNumber) || normalizeSupplierTaxId(taxId),
    confidence: decision.confidence,
    source: resolvedSource,
    keyword: keywordSupplier?.keyword ?? null,
    decision,
  }, input.knownSupplierNames);
}

function finalizeSupplierMetadata(
  candidate: SupplierMetadata,
  input: {
    senderName: string;
    ownerEmails: Set<string>;
    knownSupplierNames: Map<string, string>;
    logStep?: (message: string) => void;
  }
): SupplierMetadata {
  if (!isTaxIdLikeSupplierName(candidate.name, candidate.taxId)) {
    return withKnownSupplierName(candidate, input.knownSupplierNames);
  }

  const original = candidate.name;
  const senderFallback = normalizeSupplierName(input.senderName);
  const fallback =
    isUsableSupplierName(senderFallback, input.ownerEmails) &&
    !looksLikeEmailAddress(senderFallback) &&
    !isTaxIdLikeSupplierName(senderFallback, candidate.taxId)
      ? senderFallback
      : UNKNOWN_SUPPLIER_FALLBACK;
  input.logStep?.(`[gmail-sync] supplier name rejected as tax-id/numeric, using fallback original=${original} fallback=${fallback}`);
  return withKnownSupplierName({
    ...candidate,
    name: fallback,
    confidence: Math.min(candidate.confidence, fallback === UNKNOWN_SUPPLIER_FALLBACK ? 0.1 : 0.52),
    source: fallback === UNKNOWN_SUPPLIER_FALLBACK ? "unknown" : "sender_display",
    keyword: undefined,
  }, input.knownSupplierNames);
}

function withKnownSupplierName(candidate: SupplierMetadata, knownSupplierNames: Map<string, string>): SupplierMetadata {
  const key = canonicalSupplierKey(candidate.name);
  const known = key ? knownSupplierNames.get(key) : null;
  if (known) return { ...candidate, name: known, source: candidate.source === "document" || candidate.source === "keyword" ? candidate.source : "known_supplier" };
  if (key) knownSupplierNames.set(key, candidate.name);
  return candidate;
}

function buildKnownSupplierRegistryEntries(knownSupplierNames: Map<string, string>) {
  const entries = [];
  const seen = new Set<string>();
  for (const name of knownSupplierNames.values()) {
    const canonical = canonicalSupplierKey(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    entries.push({
      canonicalSupplier: `known:${canonical}`,
      canonicalName: name,
      normalizedName: canonical,
      aliases: [name],
      ocrVariants: [],
      vatNumber: null,
      emailDomains: [],
      knownEmails: [],
      knownPhones: [],
      category: "other" as const,
      isBlocklisted: false,
      typicalLanguage: /[\u0590-\u05FF]/u.test(name) ? "he" as const : "mixed" as const,
      typicalCurrency: "ILS",
      historicalConfidence: 0.8,
      correctionsCount: 0,
      invoicesCount: 1,
      firstSeenAt: null,
      lastSeenAt: null,
    });
  }
  return entries;
}

export function classifyOcrSupplierText(text: string) {
  const normalizedText = normalizeOcrSupplierText(text);
  const compactText = normalizedText.replace(/\s+/g, "");
  for (const rule of OCR_SUPPLIER_KEYWORD_RULES) {
    const contextMatched = !rule.contextPatterns?.length || rule.contextPatterns.some((pattern) => {
      pattern.lastIndex = 0;
      const normalizedMatch = pattern.test(normalizedText);
      pattern.lastIndex = 0;
      return normalizedMatch || pattern.test(compactText);
    });
    if (!contextMatched) continue;

    const match = rule.patterns
      .map((pattern) => {
        pattern.lastIndex = 0;
        const normalizedMatch = normalizedText.match(pattern)?.[0];
        pattern.lastIndex = 0;
        return normalizedMatch ?? compactText.match(pattern)?.[0];
      })
      .find((value): value is string => Boolean(value));
    if (match) {
      return {
        supplierName: rule.supplierName,
        confidence: rule.confidence,
        keyword: match,
        normalizedText,
      };
    }
  }
  return null;
}

export function detectMunicipalCollectionDocument(text: string): {
  detected: boolean;
  supplierName: "עיריית רמת גן" | "עירייה" | null;
  reason: string;
} {
  const normalizedText = normalizeOcrSupplierText(text);
  const compactText = normalizedText.replace(/\s+/g, "");
  const hasMunicipalCue =
    /עיריית|עירית|עיריה|עירייה|municipality/u.test(normalizedText) ||
    /עיריית|עירית|עיריה|עירייה|municipality/u.test(compactText);
  const hasRamatGan = /רמת\s+גן/u.test(normalizedText) || /רמתגן|ramatgan/u.test(compactText);
  const hasCollectionCue =
    /תשלום\s+קנס|דריש[הת]\s+לתשלום|קנס|גבייה|גביה|fine|collection/u.test(normalizedText) ||
    /תשלוםקנס|דריש[הת]לתשלום/u.test(compactText);

  if (hasMunicipalCue && hasRamatGan) {
    return { detected: true, supplierName: "עיריית רמת גן", reason: hasCollectionCue ? "ramat_gan_collection_cue" : "ramat_gan_municipality" };
  }
  if (hasMunicipalCue && hasCollectionCue) {
    return { detected: true, supplierName: "עירייה", reason: "municipal_collection_cue" };
  }
  return { detected: false, supplierName: null, reason: "municipal_collection_not_found" };
}

export function detectSupplierKeyword(text: string) {
  const result = classifyOcrSupplierText(text);
  if (!result) return null;
  return {
    supplierName: result.supplierName,
    confidence: result.confidence,
    keyword: result.keyword,
  };
}

export function normalizeOcrSupplierText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״׳"'`´]/g, "")
    .replace(/[־‐‑‒–—_/-]+/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractSupplierFromDocument(text: string, ownerEmails: Set<string>) {
  const patterns = [
    /(?:שם\s*(?:ה)?(?:ספק|חברה|עסק)|שם\s*העוסק|שם\s*המנפיק|מאת|לכבוד\s*לא\s*כולל|עוסק\s*מורשה|ח\.פ\.|חברה)[:\s-]{1,20}([^\n\r|]{2,80})/i,
    /(?:supplier|vendor|issuer|issued\s+by|company|business name|from)[:\s-]{1,20}([^\n\r|]{2,80})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeSupplierName(match?.[1] ?? "");
    if (isUsableSupplierName(candidate, ownerEmails)) return candidate;
  }
  return null;
}

function extractSupplierTaxId(text: string) {
  const match = text.match(/(?:ח\.?פ\.?|חברה\s*מספר|עוסק\s*מורשה|מספר\s*עוסק|תיק\s*עוסק|company\s*(?:id|number)|tax\s*id|vat\s*(?:id|number))[:\s#-]{0,20}([0-9]{7,10})/i);
  return match?.[1] ?? null;
}

function isTaxIdLikeSupplierName(value: string, supplierTaxId?: string | null) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/\D/g, "");
  const normalizedTaxId = supplierTaxId?.replace(/\D/g, "") ?? "";
  if (normalizedTaxId && digits === normalizedTaxId) return true;
  if (/^\d+$/.test(trimmed)) return true;

  const withoutTaxLabels = trimmed
    .replace(/(?:ח\.?פ\.?|חברה\s*מספר|עוסק\s*מורשה|מספר\s*עוסק|תיק\s*עוסק|company\s*(?:id|number)|tax\s*id|vat\s*(?:id|number))/gi, "")
    .trim();
  return digits.length >= 7 && digits.length <= 10 && /^[\d\s.-]+$/.test(withoutTaxLabels);
}

function isUsableSupplierName(value: string, ownerEmails: Set<string> = new Set()) {
  const cleaned = value.trim();
  if (isLikelyJunkSupplierName(cleaned)) return false;
  const normalizedToken = cleaned.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!cleaned || cleaned === "Unknown supplier") return false;
  if (/^(unknown|unknown supplier|לא\s+ידוע|לא\s+מזוהה|לא\s+זוהה|n\/a|null|undefined)$/i.test(cleaned)) return false;
  if (cleaned === ".name" || cleaned.startsWith(".")) return false;
  if (/[\r\n]/.test(value)) return false;
  if (cleaned.length < 2 || cleaned.length > 60) return false;
  if (looksLikeEmailAddress(cleaned)) return false;
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(cleaned)) return false;
  if ([...ownerEmails].some((email) => cleaned.toLowerCase().includes(email))) return false;
  if (/^(address|current|name|details|document|documents|number|supplier|vendor|issuer|company|business name|from)$/i.test(normalizedToken)) return false;
  if (/^multi\s+number\s+documents\b/i.test(normalizedToken)) return false;
  if (/^(invoice|receipt|payment|support|noreply|no reply|billing|accounts?|gmail|googlemail|outlook|hotmail|yahoo)$/i.test(cleaned)) return false;
  if (cleaned.includes("/")) return false;
  if (/ocr\/ai/i.test(cleaned) || /^(ocr|ai)\b/i.test(normalizedToken)) return false;
  if (/\boutput\b/i.test(normalizedToken)) return false;
  return /[\p{L}]/u.test(cleaned);
}

function supplierFromDomain(domain: string) {
  const main = domain
    .replace(/^www\./i, "")
    .split(".")
    .filter(Boolean)[0] ?? "";
  return normalizeSupplierName(main || domain || "Unknown supplier");
}

function looksLikeEmailAddress(value: string) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function isPersonalEmailDomain(domain: string) {
  return /^(gmail|googlemail|outlook|hotmail|yahoo)\./i.test(domain);
}

function canonicalSupplierKey(value: string) {
  return normalizeSupplierName(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function detectInvoice(subject: string, body: string, parts: PayloadPart[]) {
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const hasKeyword =
    INVOICE_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase())) ||
    INVOICE_KEYWORD_PATTERNS.some((pattern) => pattern.test(text));
  const hasPdf = parts.some((part) => /\.pdf$/i.test(part.filename ?? "") || part.mimeType === "application/pdf");
  const hasImage = parts.some(isInvoiceImageAttachmentPart);
  const amountResult = extractInvoiceAmount(text);
  return {
    isInvoice: hasKeyword || (hasPdf && amountResult.amount !== null) || (hasImage && hasKeyword),
    amount: amountResult.amount,
    amountRejectedReason: amountResult.rejectedReason,
  };
}

export function extractInvoiceAmount(text: string): { amount: number | null; rejectedReason: string | null } {
  const normalized = text
    .normalize("NFKC")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[״]/g, "\"");
  const prioritizedPatterns = [
    /(?:סה["']?כ\s+לתשלום|סהכ\s+לתשלום|(?:ה)?סכום\s+לתשלום|יתרה\s+לתשלום)[^\d₪$€]{0,80}(?:₪|ils|nis|ש["']?ח|\$|usd|€|eur)?\s*([0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
  ];
  const keywordPatterns = [
    /(?:סה["']?כ\s*(?:לתשלום)?|סך\s*הכל\s*(?:לתשלום)?|(?:ה)?סכום\s*לתשלום|יתרה\s*לתשלום|לתשלום|כולל\s*מע["']?מ|total\s*(?:due|amount|inc(?:luding)?\s*vat)?|grand\s*total|amount\s*(?:due|paid)?|balance\s*due|subtotal)[^\d₪$€]{0,60}(?:₪|ils|nis|ש["']?ח|\$|usd|€|eur)?\s*([0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
    /(?:₪|ils|nis|ש["']?ח|\$|usd|€|eur)\s*([0-9][0-9,\s]*(?:[.,][0-9]{1,2})?)\s*(?:סה["']?כ|סך\s*הכל|לתשלום|total|amount)?/gi,
    /₪\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/g,
    /([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)\s*(?:ש["']?ח|שקל|שקלים)/g,
    /(?:ils|nis)\s*([0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
    /([0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)\s*(?:ils|nis)/gi,
  ];
  let rejectedReason: string | null = null;
  const prioritizedAmounts: number[] = [];
  const keywordAmounts: number[] = [];
  const fallbackAmounts: number[] = [];

  const collectAmounts = (
    amountPatterns: RegExp[],
    target: number[],
    options: { requireReferenceCheck: boolean }
  ) => {
    for (const pattern of amountPatterns) {
      for (const match of normalized.matchAll(pattern)) {
        const matchIndex = match.index ?? 0;
        const rawAmount = match[1];
        if (options.requireReferenceCheck && hasReferenceNumberContext(normalized, matchIndex, match[0].length)) {
          rejectedReason = "parsed amount rejected: nearby reference/document number context";
          continue;
        }
        if (isLikelyIdentifierNumber(normalized, matchIndex, match[0].length, rawAmount)) {
          rejectedReason = "parsed amount rejected: looks like identifier not amount";
          continue;
        }
        const parsed = options.requireReferenceCheck
          ? parseAmount(rawAmount)
          : parseLabeledAmount(rawAmount);
        const amount = parsed.parsedAmount;
        if (amount !== null && !parsed.ambiguous) {
          const reason = rejectedDetectedAmountReason(amount, {
            hasDateContext: hasDateOrYearContext(normalized, matchIndex, match[0].length),
          });
          if (reason) rejectedReason = reason;
          else target.push(amount);
        }
      }
    }
  };

  collectAmounts(prioritizedPatterns, prioritizedAmounts, { requireReferenceCheck: false });
  collectAmounts(keywordPatterns, keywordAmounts, { requireReferenceCheck: true });

  const amount =
    selectExtractedInvoiceAmount(prioritizedAmounts, keywordAmounts, fallbackAmounts);
  return { amount, rejectedReason };
}

const IDENTIFIER_LABEL_CONTEXT =
  /(?:מ\s*ס(?:פר|\')?\s*(?:ח\s*שבון|חשבונית|עוסק)?|מספר\s*חשבון|אסמכתא|ח\.?\s*פ\.?|עוסק\s*מורשה|ת\.?\s*ז\.?|טלפון|phone|ref(?:erence)?|account)/i;

function isLikelyIdentifierNumber(
  text: string,
  matchIndex: number,
  matchFullLength: number,
  rawAmount: string
) {
  const trimmed = rawAmount.trim();
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  const hasDecimal = /[.,]\d{1,2}$/.test(trimmed);
  if (!hasDecimal && digitsOnly.length >= 9) return true;

  const fullMatch = text.slice(matchIndex, matchIndex + matchFullLength);
  const amountOffsetInMatch = fullMatch.lastIndexOf(trimmed);
  const amountStart =
    matchIndex + (amountOffsetInMatch >= 0 ? amountOffsetInMatch : Math.max(0, matchFullLength - trimmed.length));
  const immediateBefore = text.slice(Math.max(0, amountStart - 25), amountStart);
  return IDENTIFIER_LABEL_CONTEXT.test(immediateBefore);
}

function selectExtractedInvoiceAmount(
  prioritizedAmounts: number[],
  keywordAmounts: number[],
  fallbackAmounts: number[]
) {
  const pickConsensus = (values: number[]) => {
    if (!values.length) return null;
    const unique = [...new Set(values.map((v) => Number(v.toFixed(2))))];
    if (unique.length === 1) return unique[0];
    return null;
  };
  return (
    pickConsensus(prioritizedAmounts) ??
    pickConsensus(keywordAmounts) ??
    pickConsensus(fallbackAmounts)
  );
}

function hasReferenceNumberContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  const context = text.slice(start, end);
  if (/(?:סה["״']?כ\s*(?:לתשלום)?|סך\s*הכל|(?:ה)?סכום\s*לתשלום|יתרה\s*לתשלום|total\s*(?:due|amount)|amount\s*due|balance\s*due)/i.test(context)) {
    return false;
  }
  return REFERENCE_NUMBER_CONTEXT.test(context);
}

function hasDateOrYearContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  const context = text.slice(start, end);
  return /(?:20\d{2}[-/.][01]?\d[-/.][0-3]?\d|[0-3]?\d[-/.][01]?\d[-/.]20\d{2}|תאריך|מועד|חודש|שנה|date|due|period|year|month)/i.test(context);
}

function extractPhoneFromText(text: string) {
  return text.match(/(?:\+972|0)(?:[-\s]?\d){8,10}/)?.[0]?.replace(/[\s-]/g, "") ?? undefined;
}

export { parseAmountOrNull as parseAmount } from "./amount/parseAmount.js";

function normalizeDetectedAmount(amount: number | null | undefined) {
  if (amount == null) return null;
  return isReasonableDetectedAmount(amount) ? amount : null;
}

export function selectInvoiceAttachmentAmount(input: {
  isImageInvoicePart: boolean;
  detectedAmount: number | null | undefined;
  aiTotalAmount: number | null | undefined;
  aiAmount: number | null | undefined;
}) {
  const aiAmount = input.aiTotalAmount ?? input.aiAmount;
  return input.isImageInvoicePart
    ? normalizeDetectedAmount(aiAmount ?? input.detectedAmount)
    : normalizeDetectedAmount(input.detectedAmount ?? aiAmount);
}

export function rejectedDetectedAmountReason(amount: number | null | undefined, context?: { hasDateContext?: boolean }) {
  if (amount == null) return null;
  if (!Number.isFinite(amount) || amount <= 0) return "parsed amount looks invalid";
  if (context?.hasDateContext === true && Number.isInteger(amount) && amount >= 2020 && amount <= 2030) return "parsed amount looks like a year";
  if (amount >= MAX_AUTO_SAVE_AMOUNT) return "parsed amount looks invalid/too large";
  return null;
}

function isReasonableDetectedAmount(amount: number) {
  return rejectedDetectedAmountReason(amount) === null;
}

function normalizeBusinessDate(value: string | null | undefined, fallback: Date | null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const now = Date.now();
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
  if (date.getTime() < now - twoYearsMs || date.getTime() > now + twoYearsMs) return fallback;
  return date;
}

async function loadKnownSupplierNames(organizationId: string) {
  const [payments, invoices] = await Promise.all([
    prisma.supplierPayment.findMany({
      where: { organizationId },
      distinct: ["supplier"],
      select: { supplier: true },
      take: 500,
    }),
    prisma.gmailScanItem.findMany({
      where: {
        organizationId,
        supplierName: { not: "Unknown supplier" },
      },
      distinct: ["supplierName"],
      select: { supplierName: true },
      take: 500,
    }),
  ]);
  const names = new Map<string, string>();
  for (const name of [...payments.map((payment) => payment.supplier), ...invoices.map((invoice) => invoice.supplierName)]) {
    const key = canonicalSupplierKey(name);
    if (key && !names.has(key) && isUsableSupplierName(name)) names.set(key, name);
  }
  return names;
}

async function upsertPotentialClient(input: {
  organizationId: string;
  name: string;
  email: string;
  domain: string;
  firstSeen: Date;
  lastSeen: Date;
}) {
  const sanitized = stripNulBytesDeep(input);
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "Client" WHERE "organizationId" = $1 AND ("email" = $2 OR "domain" = $3) AND "isActive" = true ORDER BY "createdAt" ASC LIMIT 1',
    sanitized.organizationId,
    sanitized.email,
    sanitized.domain
  );
  if (existing[0]?.id) {
    await prisma.$executeRawUnsafe(
      'UPDATE "Client" SET "domain" = COALESCE("domain", $2), "firstSeen" = COALESCE("firstSeen", $3), "lastSeen" = GREATEST(COALESCE("lastSeen", $4), $4), "updatedAt" = NOW() WHERE "id" = $1',
      existing[0].id,
      sanitized.domain,
      sanitized.firstSeen,
      sanitized.lastSeen
    );
    return { id: existing[0].id, created: false };
  }

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    'INSERT INTO "Client" ("id","organizationId","name","email","domain","firstSeen","lastSeen","gmailConnected","color","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,true,NOW(),NOW())',
    id,
    sanitized.organizationId,
    sanitized.name || sanitized.domain,
    sanitized.email,
    sanitized.domain,
    sanitized.firstSeen,
    sanitized.lastSeen,
    "#6366F1"
  );
  return { id, created: true };
}

async function ensureInvoiceClient(input: {
  organizationId: string;
  supplierName: string;
  senderEmail: string;
  domain: string;
  receivedAt: Date;
}) {
  const supplierKey = canonicalSupplierKey(input.supplierName) || "invoice-supplier";
  const domain = input.domain || `${supplierKey}.local`;
  const email = input.senderEmail || `invoice-${supplierKey}@local.invalid`;
  return upsertPotentialClient({
    organizationId: input.organizationId,
    name: input.supplierName || domain,
    email,
    domain,
    firstSeen: input.receivedAt,
    lastSeen: input.receivedAt,
  });
}

async function upsertGmailLead(input: {
  organizationId: string;
  name: string;
  company: string;
  email: string;
  phone?: string;
  notes: string;
}) {
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [
        { email: input.email },
        ...(input.phone ? [{ phone: input.phone }, { whatsapp: input.phone }] : []),
      ],
    },
  });
  if (existing) return { id: existing.id, created: false };

  const lead = await prisma.lead.create({
    data: {
      organizationId: input.organizationId,
      name: input.name || input.company || input.email,
      company: input.company,
      email: input.email,
      phone: input.phone,
      whatsapp: input.phone,
      source: "email",
      stage: "חדש",
      notes: input.notes,
      score: 45,
      priorityStars: 2,
      lastContactAt: new Date(),
      timeline: {
        create: {
          type: "gmail_scan",
          content: "נוצר אוטומטית מסריקת Gmail",
          channel: "email",
        },
      },
    },
  });
  return { id: lead.id, created: true };
}

async function findExistingSupplierPayment(input: {
  organizationId: string;
  duplicateHash: string;
  lookupClauses?: Array<Record<string, unknown>>;
  emailMessageId: string;
  supplier: string;
  amount: number | null;
  date: Date;
}) {
  if (input.lookupClauses?.length) {
    const byIdentity = await prisma.supplierPayment.findFirst({
      where: {
        organizationId: input.organizationId,
        OR: input.lookupClauses,
      },
      orderBy: { createdAt: "desc" },
    });
    if (byIdentity) return byIdentity;
  }

  const byHash = await prisma.supplierPayment.findUnique({
    where: {
      organizationId_duplicateHash: {
        organizationId: input.organizationId,
        duplicateHash: input.duplicateHash,
      },
    },
  });
  if (byHash) return byHash;

  const dayStart = new Date(input.date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(input.date);
  dayEnd.setHours(23, 59, 59, 999);

  const bySameEmail = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      emailMessageId: input.emailMessageId,
    },
  });
  if (bySameEmail) return bySameEmail;

  if (input.amount !== null) {
    return prisma.supplierPayment.findFirst({
      where: {
        organizationId: input.organizationId,
        supplier: input.supplier,
        amount: input.amount,
        date: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  return null;
}

async function findSupplierPaymentByDriveLink(organizationId: string, driveLink: GmailDriveLink) {
  const clauses: Array<
    | { driveFileId: string }
    | { driveFileUrl: string }
    | { invoiceLink: string }
    | { documentLink: string }
  > = [];
  if (driveLink.fileId) clauses.push({ driveFileId: driveLink.fileId });
  if (driveLink.link) {
    clauses.push({ driveFileUrl: driveLink.link });
    clauses.push({ invoiceLink: driveLink.link });
    clauses.push({ documentLink: driveLink.link });
  }
  if (!clauses.length) return null;
  return prisma.supplierPayment.findFirst({
    where: {
      organizationId,
      OR: clauses,
    },
  });
}

async function ensureSupplierPaymentsForDriveLinks(input: {
  organizationId: string;
  email: ScannedEmail;
  driveLinks: GmailDriveLink[];
  classification: GmailScanClassification;
  analysis: EmailAnalysis;
  amount: number | null;
  supplierName: string;
  supplierMetadata: SupplierMetadata;
  invoiceNumber: string | null;
  documentDate: Date;
  dueDate: Date | null;
  parsedFieldsJson: unknown;
  documentDecision: {
    action: string;
    documentType: string;
    sourceFingerprint: string;
    documentFingerprint: string;
  };
  duplicateKey: string | null;
  logStep: (message: string) => void;
}) {
  let created = 0;
  let sheetsUpdated = 0;
  for (const driveLink of input.driveLinks) {
    if (!driveLink.link && !driveLink.fileId) continue;
    const existingByDrive = await findSupplierPaymentByDriveLink(input.organizationId, driveLink);
    if (existingByDrive) {
      input.logStep(`[gmail-sync] SUPPLIER_PAYMENT_DB_SAVE_SKIPPED message=${input.email.gmailId} file="${driveLink.filename ?? "unnamed"}" reason=drive_file_already_linked paymentId=${existingByDrive.id}`);
      continue;
    }

    const paymentNeedsReview =
      input.classification.reviewStatus === "needs_review" ||
      input.classification.confidence < 0.8 ||
      input.amount === null ||
      !isUsableSupplierName(input.supplierName);
    const amountGate = parseAmountGateFromParsedFields(input.parsedFieldsJson);
    const supplierGate = parseSupplierGateFromParsedFields(input.parsedFieldsJson);
    const fingerprintGate = parseFingerprintGateFromParsedFields(input.parsedFieldsJson);
    const duplicateGate = parseDuplicateGateFromParsedFields(input.parsedFieldsJson);
    const paymentEvaluation = evaluateFinanceTrustGates({
      selectedAmount: input.amount,
      needsReview: paymentNeedsReview,
      amountGate,
      supplierGate,
      fingerprintGate,
      duplicateGate,
      documentType: input.documentDecision.documentType,
      confidenceScore: input.classification.confidence,
      parsedFieldsJson: input.parsedFieldsJson,
    });
    if (!paymentEvaluation.shouldCreatePayment) {
      input.logStep(`[gmail-sync] SUPPLIER_PAYMENT_DB_SAVE_SKIPPED message=${input.email.gmailId} file="${driveLink.filename ?? "unnamed"}" reason=${paymentEvaluation.blockReason ?? FINANCE_AMOUNT_UNRESOLVED_REASON}`);
      continue;
    }
    const paymentAmount = paymentEvaluation.paymentAmount!;
    const paymentApprovalStatus = paymentEvaluation.approvalStatus;
    const paymentSupplierName = supplierGate?.canonicalSupplierName ?? input.supplierName;
    const dueDate = input.dueDate;
    const invoiceLink = isInvoiceRecordDocument(input.classification.documentType) ? driveLink.link : null;
    const documentLink = input.classification.documentType === "payment_request" ? driveLink.link : null;
    const missingInvoice =
      Boolean(input.analysis.paymentRequired || input.classification.documentType === "payment_request") &&
      !invoiceLink &&
      Boolean(documentLink || input.analysis.paymentRequired);
    const documentFingerprint = input.documentDecision.documentFingerprint;
    const paymentIdentity = buildPaymentLookupsFromCanonical({
      organizationId: input.organizationId,
      canonicalFingerprint: documentFingerprint,
      supplierName: paymentSupplierName,
      supplierTaxId: input.supplierMetadata.taxId,
      invoiceNumber: input.invoiceNumber,
      totalAmount: paymentAmount,
      documentDate: input.email.receivedAt,
      documentType: input.documentDecision.documentType,
      subject: input.email.subject,
      legacyGmailScanDuplicateKey: input.duplicateKey,
      sourceFingerprint: input.documentDecision.sourceFingerprint,
    });
    const duplicateHash = paymentIdentity.duplicateHash;

    const totalAmount = normalizeDetectedAmount(input.analysis.totalAmount) ?? paymentAmount;
    const existingByFingerprintOrHash = await findSupplierPaymentByDocumentIdentity({
      organizationId: input.organizationId,
      documentFingerprint,
      duplicateHash,
      lookupClauses: paymentIdentity.lookupClauses,
    });
    if (existingByFingerprintOrHash) {
      await updateSupplierPaymentMissingDriveFields(existingByFingerprintOrHash.id, driveLink, documentLink, invoiceLink);
      input.logStep(`ENSURE-PAYMENTS DEDUP HIT org=${input.organizationId} fingerprint=${shortFingerprint(documentFingerprint)}`);
      continue;
    }

    input.logStep(`[gmail-sync] SUPPLIER_PAYMENT_DB_SAVE_ATTEMPT message=${input.email.gmailId} file="${driveLink.filename ?? "unnamed"}" driveFileId=${driveLink.fileId ?? "none"} supplier="${paymentSupplierName}" amount=${paymentAmount} invoiceNumber=${input.invoiceNumber ?? "none"} dueDate=${dueDate?.toISOString() ?? "none"} status=${paymentApprovalStatus}`);
    let payment;
    try {
      const createResult = await createSupplierPaymentIfTrusted({
        evaluation: paymentEvaluation,
        data: {
          organizationId: input.organizationId,
          supplier: paymentSupplierName,
          amount: paymentAmount,
          currency: input.analysis.currency,
          date: input.email.receivedAt,
          dueDate,
          paid: false,
          documentLink,
          invoiceLink,
          driveFileId: driveLink.fileId ?? null,
          driveFileUrl: driveLink.link ?? null,
          driveUploadStatus: "uploaded",
          driveFolderId: driveLink.folderId ?? null,
          driveClientFolderId: driveLink.clientFolderId ?? null,
          driveSupplierFolderId: driveLink.supplierFolderId ?? null,
          driveFolderPath: driveLink.folderPath ?? null,
          supplierName: driveLink.supplierName ?? paymentSupplierName,
          invoiceMonth: driveLink.invoiceMonth ?? input.documentDate.getMonth() + 1,
          invoiceYear: driveLink.invoiceYear ?? input.documentDate.getFullYear(),
          invoiceNumber: input.invoiceNumber,
          documentFingerprint,
          sourceFingerprint: input.documentDecision.sourceFingerprint,
          documentTypeDetailed: input.documentDecision.documentType,
          supplierTaxId: input.supplierMetadata.taxId,
          amountBeforeVat: input.analysis.amountBeforeVat ?? null,
          vatAmount: input.analysis.vatAmount ?? null,
          totalAmount,
          confidenceScore: input.classification.confidence,
          parsedFieldsJson: input.parsedFieldsJson as any,
          approvalStatus: paymentApprovalStatus,
          sourcesJson: ["gmail"],
          emailSender: input.email.from,
          paymentRequired: input.analysis.paymentRequired,
          missingInvoice,
          duplicateHash,
          subject: input.email.subject,
          source: input.email.source,
          emailMessageId: input.email.emailRecordId,
        },
      });
      if (createResult.skipped || !createResult.payment) {
        input.logStep(`[gmail-sync] SUPPLIER_PAYMENT_DB_SAVE_SKIPPED message=${input.email.gmailId} file="${driveLink.filename ?? "unnamed"}" reason=${createResult.reason ?? "trust_gate_blocked"}`);
        continue;
      }
      payment = createResult.payment;
    } catch (err) {
      const existingAfterRace = isPrismaUniqueConstraintError(err)
        ? await findSupplierPaymentByDocumentIdentity({
            organizationId: input.organizationId,
            documentFingerprint,
            duplicateHash,
          })
        : null;
      if (existingAfterRace) {
        await updateSupplierPaymentMissingDriveFields(existingAfterRace.id, driveLink, documentLink, invoiceLink);
        input.logStep(`ENSURE-PAYMENTS DEDUP HIT org=${input.organizationId} fingerprint=${shortFingerprint(documentFingerprint)}`);
        continue;
      }
      console.error(`[gmail-sync] SupplierPayment create failed message=${input.email.gmailId} file="${driveLink.filename ?? "unnamed"}"`, err);
      input.logStep(`[gmail-sync] SupplierPayment create failed message=${input.email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
      continue;
    }
    created++;
    input.logStep(`[gmail-sync] SUPPLIER_PAYMENT_DB_SAVE_SUCCESS message=${input.email.gmailId} paymentId=${payment.id} file="${driveLink.filename ?? "unnamed"}" driveFileId=${driveLink.fileId ?? "none"} status=${paymentApprovalStatus}`);

    const sheetInput = {
      organizationId: input.organizationId,
      paymentId: payment.id,
      supplier: paymentSupplierName,
      amount: paymentAmount,
      date: input.email.receivedAt,
      dueDate,
      paid: false,
      missingInvoice,
      documentLink,
      invoiceLink,
      gmailLink: gmailMessageLink(input.email.gmailId),
      supplierTaxId: input.supplierMetadata.taxId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.documentDate,
      source: "gmail",
      duplicateDetected: false,
      duplicateReason: null,
      driveFolderLink: driveLink.folderId ? `https://drive.google.com/drive/folders/${driveLink.folderId}` : null,
      paidDate: null,
      receiptLink: null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
    if (!hasSupplierPaymentSheetRowData(sheetInput)) {
      input.logStep(`[gmail-sync] Sheets append skipped message=${input.email.gmailId} paymentId=${payment.id} reason=empty_supplier_payment_row`);
      continue;
    }
    await appendSupplierPaymentToSheet(sheetInput).then((sheet) => {
      if (!("skipped" in sheet && sheet.skipped)) sheetsUpdated++;
      input.logStep(`[gmail-sync] Sheets append success message=${input.email.gmailId} paymentId=${payment.id} spreadsheet=${sheet.spreadsheetId || "skipped"}`);
    }).catch((err) => {
      console.error(`[gmail-sync] Sheets append failed message=${input.email.gmailId} paymentId=${payment.id}`, err);
      input.logStep(`[gmail-sync] Sheets append failed message=${input.email.gmailId} reason="${err instanceof Error ? err.message : String(err)}"`);
    });
  }
  return { created, sheetsUpdated };
}

async function findSupplierPaymentByDocumentIdentity(input: {
  organizationId: string;
  documentFingerprint: string;
  duplicateHash: string;
  lookupClauses?: Array<Record<string, unknown>>;
}) {
  if (input.lookupClauses?.length) {
    return prisma.supplierPayment.findFirst({
      where: {
        organizationId: input.organizationId,
        OR: input.lookupClauses,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  return prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [
        { documentFingerprint: input.documentFingerprint },
        { duplicateHash: input.duplicateHash },
      ],
    },
  });
}

async function updateSupplierPaymentMissingDriveFields(
  paymentId: string,
  driveLink: GmailDriveLink,
  documentLink: string | null,
  invoiceLink: string | null
) {
  const existing = await prisma.supplierPayment.findUnique({
    where: { id: paymentId },
    select: {
      documentLink: true,
      invoiceLink: true,
      driveFileId: true,
      driveFileUrl: true,
      driveUploadStatus: true,
      driveFolderId: true,
      driveClientFolderId: true,
      driveSupplierFolderId: true,
      driveFolderPath: true,
      supplierName: true,
      invoiceMonth: true,
      invoiceYear: true,
    },
  });
  if (!existing) return;

  const data = {
    ...(documentLink && !existing.documentLink ? { documentLink } : {}),
    ...(invoiceLink && !existing.invoiceLink ? { invoiceLink } : {}),
    ...(driveLink.fileId && !existing.driveFileId ? { driveFileId: driveLink.fileId } : {}),
    ...(driveLink.link && !existing.driveFileUrl ? { driveFileUrl: driveLink.link } : {}),
    ...(!existing.driveUploadStatus ? { driveUploadStatus: "uploaded" } : {}),
    ...(driveLink.folderId && !existing.driveFolderId ? { driveFolderId: driveLink.folderId } : {}),
    ...(driveLink.clientFolderId && !existing.driveClientFolderId ? { driveClientFolderId: driveLink.clientFolderId } : {}),
    ...(driveLink.supplierFolderId && !existing.driveSupplierFolderId ? { driveSupplierFolderId: driveLink.supplierFolderId } : {}),
    ...(driveLink.folderPath && !existing.driveFolderPath ? { driveFolderPath: driveLink.folderPath } : {}),
    ...(driveLink.supplierName && !existing.supplierName ? { supplierName: driveLink.supplierName } : {}),
    ...(driveLink.invoiceMonth && !existing.invoiceMonth ? { invoiceMonth: driveLink.invoiceMonth } : {}),
    ...(driveLink.invoiceYear && !existing.invoiceYear ? { invoiceYear: driveLink.invoiceYear } : {}),
  };
  if (Object.keys(data).length === 0) return;
  await prisma.supplierPayment.update({ where: { id: paymentId }, data });
}

function isPrismaUniqueConstraintError(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

function shortFingerprint(fingerprint: string) {
  return fingerprint.slice(0, 12);
}

async function createPaymentAlertOnce(input: {
  organizationId: string;
  type: "missing_invoice" | "new_invoice";
  supplierName: string;
  subject: string;
  amount: number | null;
  gmailMessageId: string;
}) {
  const title = input.type === "missing_invoice"
    ? `חסרה חשבונית: ${input.supplierName}`
    : `חשבונית חדשה: ${input.supplierName}`;
  const body = `${input.subject} — ₪${input.amount ?? "?"} — ${input.gmailMessageId}`;
  const existing = await prisma.alert.findFirst({
    where: {
      organizationId: input.organizationId,
      type: input.type,
      title,
      body,
    },
  });
  if (existing) return existing;
  return prisma.alert.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      title,
      body,
    },
  });
}

async function createMissingInvoiceTaskOnce(input: {
  organizationId: string;
  supplierName: string;
  subject: string;
  amount: number | null;
  emailMessageId: string;
  gmailMessageId: string;
}) {
  await createPaymentAlertOnce({
    organizationId: input.organizationId,
    type: "missing_invoice",
    supplierName: input.supplierName,
    subject: input.subject,
    amount: input.amount,
    gmailMessageId: input.gmailMessageId,
  });
  const existing = await prisma.task.findUnique({
    where: {
      organizationId_emailMessageId: {
        organizationId: input.organizationId,
        emailMessageId: input.emailMessageId,
      },
    },
  });
  if (existing) return existing;
  return prisma.task.upsert({
    where: {
      organizationId_emailMessageId: {
        organizationId: input.organizationId,
        emailMessageId: input.emailMessageId,
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      title: `MissingInvoice: ${input.supplierName}`,
      description: `${input.subject}\nGmail: ${gmailMessageLink(input.gmailMessageId)}\nAmount: ${input.amount ?? "unknown"}`,
      supplier: input.supplierName,
      priority: "high",
      status: "open",
      source: "gmail",
      emailMessageId: input.emailMessageId,
    },
  });
}

async function closeMissingInvoiceTask(organizationId: string, emailMessageId: string) {
  await prisma.task.updateMany({
    where: {
      organizationId,
      emailMessageId,
      title: { startsWith: "MissingInvoice:" },
      status: "open",
    },
    data: { status: "completed" },
  });
}

async function saveDetectedInvoice(input: {
  organizationId: string;
  clientId: string;
  amount: number;
  currency: string;
  date: Date;
  dueDate: Date | null;
  invoiceNumber: string | null;
  supplierName: string;
  documentType: GmailDocumentType;
  status?: string;
  fromEmail: string;
  subject: string;
  emailMessageId: string;
  gmailMessageId: string;
  invoiceDedupeKey?: string | null;
  attachmentFilename?: string | null;
  gmailAttachmentId?: string | null;
  allowMultipleInvoicesForMessage?: boolean;
  driveUrl: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  driveUploadStatus: string | null;
  driveFolderId: string | null;
  driveClientFolderId: string | null;
  driveSupplierFolderId: string | null;
  driveFolderPath: string | null;
  invoiceMonth: number | null;
  invoiceYear: number | null;
}) {
  if (input.invoiceDedupeKey) {
    const existingByAttachment = await prisma.invoice.findFirst({
      where: { organizationId: input.organizationId, emailId: input.invoiceDedupeKey },
      select: { id: true },
    });
    if (existingByAttachment) return null;
  }

  if (!input.allowMultipleInvoicesForMessage) {
    const existingByGmail = await prisma.invoice.findFirst({
      where: { organizationId: input.organizationId, gmailMessageId: input.gmailMessageId },
      select: { id: true },
    });
    if (existingByGmail) return null;
  }

  const dateStart = new Date(input.date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(input.date);
  dateEnd.setHours(23, 59, 59, 999);
  if (!input.allowMultipleInvoicesForMessage) {
    const existingByBusinessKey = await prisma.invoice.findFirst({
      where: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        amount: input.amount,
        date: { gte: dateStart, lte: dateEnd },
        ...(input.invoiceNumber
          ? { invoiceNumber: input.invoiceNumber }
          : { description: { contains: input.supplierName, mode: "insensitive" } }),
      },
      select: { id: true },
    });
    if (existingByBusinessKey) return null;
  }

  const attachmentDescription = input.invoiceDedupeKey
    ? `\nAttachment: ${input.attachmentFilename ?? "unknown"} (${input.gmailAttachmentId ?? "no-id"})`
    : "";

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      currency: input.currency || "ILS",
      date: input.date,
      dueDate: input.dueDate,
      status: input.status ?? (input.documentType === "receipt" ? "paid" : "pending"),
      description: `${input.supplierName} · ${input.subject}\nGmail: ${gmailMessageLink(input.gmailMessageId)}${attachmentDescription}`,
      driveUrl: input.driveUrl,
      driveFileId: input.driveFileId,
      driveFileUrl: input.driveFileUrl,
      driveUploadStatus: input.driveUploadStatus,
      driveFolderId: input.driveFolderId,
      driveClientFolderId: input.driveClientFolderId,
      driveSupplierFolderId: input.driveSupplierFolderId,
      driveFolderPath: input.driveFolderPath,
      supplierName: input.supplierName,
      invoiceMonth: input.invoiceMonth,
      invoiceYear: input.invoiceYear,
      emailId: input.invoiceDedupeKey ?? input.emailMessageId,
      fromEmail: input.fromEmail,
      gmailMessageId: input.gmailMessageId,
    },
  });
  const invoiceDriveUrl = invoice.driveFileUrl ?? invoice.driveUrl;
  if (invoiceDriveUrl) {
    console.log(
      `[gmail-sync] DRIVE_URL_SAVED org=${input.organizationId} target=invoice id=${invoice.id} message=${input.gmailMessageId} driveUrl=${invoiceDriveUrl}`
    );
    console.log(
      `[gmail-sync] INVOICE_DRIVE_LINK_SAVED org=${input.organizationId} target=invoice id=${invoice.id} message=${input.gmailMessageId} driveUrl=${invoiceDriveUrl}`
    );
  }
  return invoice;
}

export type ParsedGmailFinancialFields = {
  supplierName: string;
  amount: number | null;
  finalTotalAmount: number | null;
  documentDate: Date;
  invoiceNumber: string | null;
};

export async function fetchAndParseGmailMessageFinancialFields(input: {
  organizationId: string;
  gmail: GmailClient;
  gmailMessageId: string;
}): Promise<ParsedGmailFinancialFields> {
  const logStep = () => {};
  const full = await withRetry(
    () => input.gmail.users.messages.get({
      userId: "me",
      id: input.gmailMessageId,
      format: "full",
    }),
    `[gmail-sync] Gmail message fetch retry message=${input.gmailMessageId}`
  );

  const headers = full.data.payload?.headers ?? [];
  const subject = decodeMimeHeader(
    headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(ללא נושא)"
  );
  const from = decodeMimeHeader(headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "");
  const dateHeader = headers.find((h) => h.name?.toLowerCase() === "date")?.value ?? "";
  const receivedAt = dateHeader ? new Date(dateHeader) : new Date();
  const bodyText = extractBody(full.data.payload as PayloadPart | undefined);
  const sender = parseSender(from);
  const attachmentParts = collectAttachmentParts(full.data.payload as PayloadPart | undefined);

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { user: { select: { email: true } } },
  });
  const ownerEmails = new Set(
    [organization?.user.email].filter((email): email is string => Boolean(email)).map((email) => email.toLowerCase())
  );
  const knownSupplierNames = await loadKnownSupplierNames(input.organizationId);

  const pdfText = await extractPdfTextFromParts(input.gmail, input.gmailMessageId, attachmentParts);
  const visualAttachmentHints = await extractVisualAttachmentHints(
    input.gmail,
    input.gmailMessageId,
    attachmentParts,
    from,
    logStep,
    ownerEmails
  );
  const visualAttachmentText = visualAttachmentHints.text;
  const bodyForAnalysis = [bodyText, pdfText && `--- PDF ATTACHMENT TEXT ---\n${pdfText}`, visualAttachmentText && `--- VISUAL ATTACHMENT ANALYSIS ---\n${visualAttachmentText}`].filter(Boolean).join("\n\n");
  const supplierEvidenceText = [subject, bodyForAnalysis].filter(Boolean).join("\n\n");

  const analysis = await analyzeEmailContent({
    subject,
    body: bodyForAnalysis,
    filenames: attachmentParts.map((part) => part.filename).filter(Boolean) as string[],
    sender: from,
  });
  const extractedFields = extractHebrewInvoiceFieldsFromText(`${supplierEvidenceText}\n${analysis.supplier ?? ""}`);
  const invoiceMatch = detectInvoice(subject, bodyForAnalysis, attachmentParts);
  const moneyDecision = resolveGmailOrgMoneyDecision({
    organizationId: input.organizationId,
    documentType: analysis.documentType,
    analysis,
    extractedFieldsAmount: extractedFields.amount,
    regexDetectedAmount: invoiceMatch.amount,
  });
  const finalTotalAmount = resolvePersistedTotalAmount(moneyDecision);
  const amount = finalTotalAmount;

  const supplierMetadata = resolveSupplierMetadata({
    analysisSupplier: analysis.supplier,
    analysisSupplierTaxId: analysis.supplierTaxId,
    bodyText: supplierEvidenceText,
    senderName: sender.name,
    senderEmail: sender.email ?? "",
    senderDomain: sender.domain ?? "",
    ownerEmails,
    knownSupplierNames,
    logStep,
  });

  const invoiceNumberForDecision =
    normalizeInvoiceNumberCandidate(analysis.invoiceNumber ?? "") ??
    extractedFields.invoiceNumber ??
    extractInvoiceNumber([subject, bodyForAnalysis, primaryAttachmentFilename(attachmentParts) ?? ""].join("\n"));
  const documentDateForDecision = normalizeBusinessDate(analysis.invoiceDate ?? extractedFields.invoiceDate, receivedAt) ?? receivedAt;

  return {
    supplierName: supplierMetadata.name,
    amount,
    finalTotalAmount,
    documentDate: documentDateForDecision,
    invoiceNumber: invoiceNumberForDecision,
  };
}

