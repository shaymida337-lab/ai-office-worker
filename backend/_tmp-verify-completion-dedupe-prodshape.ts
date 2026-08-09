/**
 * Verify dedupe against prod-shaped Tire/Pharm + camera FDR (no live mutate)
 */
import {
  dedupeCompletionCandidatesPreferGsi,
  paginateFilteredCompletionCandidates,
} from "./src/services/invoiceCompletion/completionQueueQuery.ts";

const now = new Date("2026-07-26T11:10:00.000Z");
function row(p: Record<string, unknown> & { id: string; source: string }) {
  return {
    clientId: "",
    invoiceNumber: null,
    amount: null,
    currency: "ILS",
    date: now,
    status: "needs_review",
    reviewStatus: "needs_review",
    reviewSourceId: null,
    driveUrl: null,
    driveFileUrl: null,
    client: null,
    supplierName: null,
    documentType: "receipt",
    isComplete: false,
    dataComplete: false,
    approvalRequired: true,
    missingDataReasons: ["ממתין לאישור"],
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

const collected = [
  row({
    id: "gmail-scan:cms1p5nwl008xj81s2yeavjyx",
    source: "gmail_scan_item",
    amount: 450,
    supplierName: "GENERAL TIRE",
    gmailMessageId: "19f9e1a31eb03f30",
    emailMessageId: "cms1p4jvj007nj81sgqbllbuo",
    duplicateKey: "31bb488407fe3ab3cc106a07b7b8628d54ed206f357078cf",
    documentFingerprint: "31bb488407fe3ab3cc106a07b7b8628d54ed206f357078cf",
  }),
  row({
    id: "document-review:cms1p5fn1008rj81sxvqogrc8",
    source: "financial_document_review",
    amount: 450,
    supplierName: "GENERAL TIRE",
    gmailMessageId: "19f9e1a31eb03f30",
    emailMessageId: "cms1p4jvj007nj81sgqbllbuo",
    documentFingerprint: "31bb488407fe3ab3cc106a07b7b8628d54ed206f357078cf",
    duplicateKey: "31bb488407fe3ab3cc106a07b7b8628d54ed206f357078cf",
  }),
  row({
    id: "gmail-scan:cms1p5x0k0091j81sy1y0xkcr",
    source: "gmail_scan_item",
    amount: 918,
    supplierName: "סופר פארם",
    gmailMessageId: "19f9e19c826d7978",
    emailMessageId: "cms1p4r7z007vj81sml5dnnzf",
    duplicateKey: "8e905c21930e9bd91a198412c3b59efdc2b5199b512f180e",
    documentFingerprint: "8e905c21930e9bd91a198412c3b59efdc2b5199b512f180e",
  }),
  row({
    id: "document-review:cms1p5woj008zj81s99yq2wfp",
    source: "financial_document_review",
    amount: 918,
    supplierName: "סופר פארם",
    gmailMessageId: "19f9e19c826d7978",
    emailMessageId: "cms1p4r7z007vj81sml5dnnzf",
    documentFingerprint: "8e905c21930e9bd91a198412c3b59efdc2b5199b512f180e",
    duplicateKey: "8e905c21930e9bd91a198412c3b59efdc2b5199b512f180e",
  }),
  row({
    id: "document-review:camera-only-1",
    source: "financial_document_review",
    amount: 33,
    supplierName: "Camera Merchant",
    gmailMessageId: null,
    emailMessageId: null,
    documentFingerprint: "fp-camera-only",
    duplicateKey: "fp-camera-only",
  }),
];

const deduped = dedupeCompletionCandidatesPreferGsi(collected as any);
const page = paginateFilteredCompletionCandidates(deduped as any, { page: 1, pageSize: 25 });
const tire = page.pageRows.filter((r) => Number(r.amount) === 450);
const pharm = page.pageRows.filter((r) => Number(r.amount) === 918);
const camera = page.pageRows.filter((r) => r.id.includes("camera-only"));

console.log(
  JSON.stringify(
    {
      sourceRowsScanned: collected.length,
      afterDedupe: deduped.length,
      total: page.total,
      tireCount: tire.length,
      tireSource: tire[0]?.source ?? null,
      pharmCount: pharm.length,
      pharmSource: pharm[0]?.source ?? null,
      cameraKept: camera.length === 1,
      ok:
        tire.length === 1 &&
        tire[0]?.source === "gmail_scan_item" &&
        pharm.length === 1 &&
        pharm[0]?.source === "gmail_scan_item" &&
        camera.length === 1 &&
        page.total === 3,
    },
    null,
    2
  )
);
