import { prisma } from "../../lib/prisma.js";
import type { SttVocabulary } from "./sttAccuracyTypes.js";
import {
  filterSupplierNamesForStt,
  recordSupplierNameHygieneScan,
} from "./supplierNameValidation.js";

export const DEFAULT_BUSINESS_TERMS = [
  "חשבונית",
  "חשבוניות",
  "תשלום",
  "תשלומים",
  "ספק",
  "ספקים",
  "לקוח",
  "לקוחות",
  "תור",
  "פגישה",
  "סכום",
  "שקל",
  "שקלים",
  "מע״מ",
  "טיוטה",
  "קבלה",
  "חשבונית מס",
  "העברה בנקאית",
  "בזק",
  "חברת החשמל",
  "וולט",
  "פנגו",
];

const WHISPER_PROMPT_MAX_LENGTH = 800;

const APPOINTMENT_TRANSCRIPTION_KEYWORDS =
  "היום, מחר, מחרתיים, ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת, תקבעי, תור, פגישה, בשעה, בבוקר, אחר הצהריים, בערב";

const INVOICE_TRANSCRIPTION_KEYWORDS =
  "חשבונית, חשבוניות, תשלום, ספק, סכום, שקל, קבלה, מספר חשבונית, תאריך, מע״מ";

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function loadSttVocabulary(organizationId: string): Promise<SttVocabulary> {
  const [organization, clients, services, members, invoices, supplierPayments, documentReviews] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, businessProfile: true },
    }),
    prisma.client.findMany({
      where: { organizationId, isActive: true },
      select: { name: true },
      take: 100,
      orderBy: { name: "asc" },
    }),
    prisma.service.findMany({
      where: { organizationId, isActive: true },
      select: { name: true },
      take: 40,
      orderBy: { name: "asc" },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId },
      select: { user: { select: { name: true } } },
      take: 40,
    }),
    prisma.invoice.findMany({
      where: { organizationId },
      select: { supplierName: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId },
      select: { supplierName: true, supplier: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    prisma.financialDocumentReview.findMany({
      where: { organizationId },
      select: { supplierName: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rawSupplierNames = uniqueTrimmed([
    ...invoices.map((row) => row.supplierName ?? ""),
    ...supplierPayments.map((row) => row.supplierName ?? row.supplier ?? ""),
    ...documentReviews.map((row) => row.supplierName ?? ""),
  ]);
  const supplierFilter = filterSupplierNamesForStt(rawSupplierNames);
  recordSupplierNameHygieneScan({
    candidateCount: rawSupplierNames.length,
    ignoredCount: supplierFilter.ignoredCount,
    ignoredByReason: supplierFilter.ignoredByReason,
  });

  const profileTerms =
    organization?.businessProfile
      ?.split(/\r?\n/)
      .flatMap((line) => line.split(/[=:,]/))
      .map((part) => part.trim())
      .filter((part) => part.length > 1 && part.length <= 40) ?? [];

  return {
    organizationId,
    organizationName: organization?.name ?? null,
    clientNames: clients.map((client) => client.name),
    supplierNames: supplierFilter.accepted,
    serviceNames: services.map((service) => service.name),
    memberNames: members.map((member) => member.user.name).filter(Boolean) as string[],
    businessTerms: uniqueTrimmed([...DEFAULT_BUSINESS_TERMS, ...profileTerms]),
  };
}

export function buildWhisperPromptHint(vocabulary: SttVocabulary): string | undefined {
  const clientNames = vocabulary.clientNames.slice(0, 40);
  const supplierNames = vocabulary.supplierNames.slice(0, 30);
  const serviceNames = vocabulary.serviceNames.slice(0, 30);

  const base = `שיחה בעברית עסקית. מילות מפתח: ${APPOINTMENT_TRANSCRIPTION_KEYWORDS}, ${INVOICE_TRANSCRIPTION_KEYWORDS}.`;
  let selectedClients = [...clientNames];
  let selectedSuppliers = [...supplierNames];
  let selectedServices = [...serviceNames];

  while (true) {
    const clientsSegment = selectedClients.length ? ` שמות לקוחות: ${selectedClients.join(", ")}.` : "";
    const suppliersSegment = selectedSuppliers.length ? ` שמות ספקים: ${selectedSuppliers.join(", ")}.` : "";
    const servicesSegment = selectedServices.length ? ` שמות שירותים: ${selectedServices.join(", ")}.` : "";
    const prompt = `${base}${clientsSegment}${suppliersSegment}${servicesSegment}`;
    if (prompt.length <= WHISPER_PROMPT_MAX_LENGTH) return prompt;
    if (selectedServices.length > 0) {
      selectedServices = selectedServices.slice(0, -1);
      continue;
    }
    if (selectedSuppliers.length > 0) {
      selectedSuppliers = selectedSuppliers.slice(0, -1);
      continue;
    }
    if (selectedClients.length > 0) {
      selectedClients = selectedClients.slice(0, -1);
      continue;
    }
    return base.length <= WHISPER_PROMPT_MAX_LENGTH ? base : undefined;
  }
}
