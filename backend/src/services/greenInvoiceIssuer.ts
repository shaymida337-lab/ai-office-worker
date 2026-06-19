import type {
  GreenInvoiceCreateDocumentParams,
  GreenInvoiceCreatedDocument,
  GreenInvoiceEnv,
} from "./green-invoice.js";
import {
  mapDraftToGreenInvoiceDocument,
  type GreenInvoiceDraftInput,
  type MapDraftToGreenInvoiceOptions,
} from "./greenInvoiceDraftMapper.js";

export type IssueDraftInput = GreenInvoiceDraftInput & {
  id: string;
  approvedAt: Date | null;
  greenInvoiceDocumentId: string | null;
};

export type IssueOrganizationInput = {
  greenInvoiceEnv: string | null;
  greenInvoiceApiKeyId: string | null;
  greenInvoiceApiSecret: string | null;
};

export type GreenInvoiceIssuerDeps = {
  createDocument: (
    apiKeyId: string,
    apiSecret: string,
    env: GreenInvoiceEnv,
    params: GreenInvoiceCreateDocumentParams
  ) => Promise<GreenInvoiceCreatedDocument>;
  saveDocumentId: (draftId: string, documentId: string) => Promise<void>;
};

export async function issueDraftToGreenInvoice(
  draft: IssueDraftInput,
  organization: IssueOrganizationInput,
  deps: GreenInvoiceIssuerDeps,
  options?: MapDraftToGreenInvoiceOptions
): Promise<GreenInvoiceCreatedDocument> {
  if (organization.greenInvoiceEnv !== "sandbox") {
    throw new Error("Green Invoice issuance is allowed in sandbox environment only");
  }

  const apiKeyId = organization.greenInvoiceApiKeyId?.trim();
  const apiSecret = organization.greenInvoiceApiSecret?.trim();
  if (!apiKeyId || !apiSecret) {
    throw new Error("Green Invoice API credentials are required");
  }

  if (!draft.approvedAt) {
    throw new Error("Draft must be approved before issuance");
  }

  if (draft.greenInvoiceDocumentId) {
    throw new Error("Draft already issued");
  }

  const params = mapDraftToGreenInvoiceDocument(draft, options);
  const result = await deps.createDocument(apiKeyId, apiSecret, "sandbox", params);

  const documentId = result.id ?? result.documentId;
  if (!documentId) {
    throw new Error("Green Invoice document id missing from create response");
  }

  await deps.saveDocumentId(draft.id, documentId);
  return result;
}
