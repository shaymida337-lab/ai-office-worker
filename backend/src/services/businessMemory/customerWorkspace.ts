/**
 * Customer Workspace foundation (Phase 2) — architecture only, no UI.
 *
 * Future Natalie answers like "מה סקרתי עם שרית?" by assembling sections from
 * contracts, calendar, emails, tasks, and documents. Phase 2 populates only the
 * documents section from Business Memory; other sections are typed placeholders
 * so future sources plug in without changing the workspace interface.
 */

import { searchBusinessMemory } from "./businessMemoryRepository.js";
import type { BusinessMemoryDocument, BusinessMemoryDocumentType } from "./businessMemoryTypes.js";

/** Future workspace sections — each will gain its own source adapter. */
export const CUSTOMER_WORKSPACE_SECTIONS = [
  "contracts",
  "invoices",
  "quotations",
  "meetings",
  "tasks",
  "documents",
  "emails",
  "notes",
] as const;

export type CustomerWorkspaceSection = (typeof CUSTOMER_WORKSPACE_SECTIONS)[number];

export type CustomerWorkspace = {
  customerName: string;
  clientId: string | null;
  sections: Record<CustomerWorkspaceSection, BusinessMemoryDocument[]>;
};

const DOCUMENT_TYPE_TO_SECTION: Partial<Record<BusinessMemoryDocumentType, CustomerWorkspaceSection>> = {
  contract: "contracts",
  agreement: "contracts",
  quotation: "quotations",
  warranty: "documents",
  manual: "documents",
  license: "documents",
  certificate: "documents",
  other: "documents",
};

function emptySections(): Record<CustomerWorkspaceSection, BusinessMemoryDocument[]> {
  return {
    contracts: [],
    invoices: [],
    quotations: [],
    meetings: [],
    tasks: [],
    documents: [],
    emails: [],
    notes: [],
  };
}

/**
 * Build a customer-centric workspace view. Phase 2: documents (+ typed contracts/
 * quotations buckets) from Business Memory only. Calendar/Gmail/Tasks/Invoices
 * adapters will fill their sections in future phases without API changes here.
 */
export async function buildCustomerWorkspace(input: {
  organizationId: string;
  customerName: string;
  clientId?: string | null;
}): Promise<CustomerWorkspace> {
  const sections = emptySections();
  const customerName = input.customerName.trim();
  if (!customerName) {
    return { customerName: "", clientId: input.clientId ?? null, sections };
  }

  const documents = await searchBusinessMemory({
    organizationId: input.organizationId,
    subject: customerName,
    limit: 100,
  });

  for (const doc of documents) {
    const section = DOCUMENT_TYPE_TO_SECTION[doc.documentType] ?? "documents";
    sections[section].push(doc);
    if (section !== "documents" && doc.documentType === "other") {
      sections.documents.push(doc);
    }
  }

  return {
    customerName,
    clientId: input.clientId ?? null,
    sections,
  };
}

/**
 * Future AI reasoning entry point: gather all customer-linked memory across
 * sources. Phase 2 returns document sections only; interface stays stable.
 */
export async function gatherCustomerMemoryContext(input: {
  organizationId: string;
  customerName: string;
  clientId?: string | null;
}): Promise<{
  workspace: CustomerWorkspace;
  /** Flat list for deterministic lookup / future RAG. */
  allDocuments: BusinessMemoryDocument[];
}> {
  const workspace = await buildCustomerWorkspace(input);
  const allDocuments = [
    ...workspace.sections.contracts,
    ...workspace.sections.quotations,
    ...workspace.sections.documents,
  ];
  const seen = new Set<string>();
  const unique = allDocuments.filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
  return { workspace, allDocuments: unique };
}
