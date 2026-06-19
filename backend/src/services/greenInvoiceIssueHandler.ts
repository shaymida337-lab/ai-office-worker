import type {
  GreenInvoiceCreateDocumentParams,
  GreenInvoiceCreatedDocument,
  GreenInvoiceEnv,
} from "./green-invoice.js";
import {
  issueDraftToGreenInvoice,
  type IssueDraftInput,
  type IssueOrganizationInput,
} from "./greenInvoiceIssuer.js";

export type IssueDraftHandlerDeps = {
  draftId: string;
  organizationId: string;
  loadDraft: (draftId: string, organizationId: string) => Promise<IssueDraftInput | null>;
  loadOrganization: (organizationId: string) => Promise<IssueOrganizationInput | null>;
  createDocument: (
    apiKeyId: string,
    apiSecret: string,
    env: GreenInvoiceEnv,
    params: GreenInvoiceCreateDocumentParams
  ) => Promise<GreenInvoiceCreatedDocument>;
  saveDocumentId: (draftId: string, documentId: string) => Promise<void>;
};

export type IssueDraftHandlerSuccessBody = {
  success: true;
  documentId: string;
  document: GreenInvoiceCreatedDocument;
};

export type IssueDraftHandlerErrorBody = {
  success: false;
  error: string;
};

export type IssueDraftHandlerResult = {
  status: number;
  body: IssueDraftHandlerSuccessBody | IssueDraftHandlerErrorBody;
};

export async function issueDraftHandler(deps: IssueDraftHandlerDeps): Promise<IssueDraftHandlerResult> {
  const { draftId, organizationId, loadDraft, loadOrganization, createDocument, saveDocumentId } = deps;

  const draft = await loadDraft(draftId, organizationId);
  if (!draft) {
    return { status: 404, body: { success: false, error: "draft not found" } };
  }

  const organization = await loadOrganization(organizationId);
  if (!organization) {
    return { status: 400, body: { success: false, error: "organization not found" } };
  }

  try {
    const result = await issueDraftToGreenInvoice(draft, organization, { createDocument, saveDocumentId });
    const documentId = result.id ?? result.documentId;
    return {
      status: 200,
      body: { success: true, documentId: documentId!, document: result },
    };
  } catch (e) {
    return {
      status: 400,
      body: { success: false, error: e instanceof Error ? e.message : String(e) },
    };
  }
}
