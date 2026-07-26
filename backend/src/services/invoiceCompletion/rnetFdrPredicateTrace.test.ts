import test from "node:test";
import assert from "node:assert/strict";
import { CROSS_ORG_QUARANTINE_MARKER } from "../p0/crossOrgGmailQuarantine.js";
import {
  buildRnetFdrIsolationBranchProbes,
  evaluateFirstFailingRnetFdrPredicate,
  slimRnetFdrSafeFields,
  type RnetFdrSafeRow,
} from "./rnetFdrPredicateTrace.js";

const ORG = "cmqw27e43002bm92bmf9mjy1n";

function row(partial: Partial<RnetFdrSafeRow> = {}): RnetFdrSafeRow {
  return {
    id: "cmqw3n5hx020dm92bp1joi8wu",
    organizationId: ORG,
    reviewStatus: "needs_review",
    documentType: "tax_invoice_receipt",
    source: "gmail",
    gmailMessageId: "gmail-1",
    documentFingerprint: "87d30575abc",
    uncertaintyReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
    ...partial,
  };
}

test("slimRnetFdrSafeFields never includes gmail id / uncertainty text / supplier", () => {
  const slim = slimRnetFdrSafeFields(row({ uncertaintyReason: CROSS_ORG_QUARANTINE_MARKER }), ORG, [
    "gmail-1",
  ]);
  const json = JSON.stringify(slim);
  assert.equal(slim.found, true);
  assert.equal(slim.orgIdMatches, true);
  assert.equal(slim.hasGmailMessageId, true);
  assert.equal(slim.gmailMessageIdInContaminatedList, true);
  assert.equal(slim.uncertaintyReasonHasQuarantineMarker, true);
  assert.equal(json.includes("gmail-1"), false);
  assert.equal(json.includes(CROSS_ORG_QUARANTINE_MARKER), false);
  assert.equal(json.includes("supplier"), false);
});

test("evaluateFirstFailingRnetFdrPredicate: contaminated gmail fails isolation OR", () => {
  const failing = evaluateFirstFailingRnetFdrPredicate({
    row: row(),
    organizationId: ORG,
    reviewStatusIn: ["needs_review", "rejected"],
    documentTypeIn: ["tax_invoice", "receipt", "tax_invoice_receipt"],
    excludedGmailIds: ["gmail-1"],
  });
  assert.equal(failing, "isolation.gmailMessageId_contaminated_or");
});

test("evaluateFirstFailingRnetFdrPredicate: quarantine uncertainty fails before gmail", () => {
  const failing = evaluateFirstFailingRnetFdrPredicate({
    row: row({
      uncertaintyReason: `x ${CROSS_ORG_QUARANTINE_MARKER}`,
      gmailMessageId: "gmail-1",
    }),
    organizationId: ORG,
    reviewStatusIn: ["needs_review"],
    documentTypeIn: ["tax_invoice_receipt"],
    excludedGmailIds: ["gmail-1"],
  });
  assert.equal(failing, "isolation.uncertaintyReason_quarantine_or");
});

test("evaluateFirstFailingRnetFdrPredicate: null gmail passes contaminated notIn", () => {
  const failing = evaluateFirstFailingRnetFdrPredicate({
    row: row({ gmailMessageId: null }),
    organizationId: ORG,
    reviewStatusIn: ["needs_review"],
    documentTypeIn: ["tax_invoice_receipt"],
    excludedGmailIds: ["gmail-other"],
  });
  assert.equal(failing, null);
});

test("buildRnetFdrIsolationBranchProbes exposes uncertainty + gmail OR arms", () => {
  const branches = buildRnetFdrIsolationBranchProbes(ORG, ["gmail-x"]);
  const stages = branches.map((b) => b.stage);
  assert.ok(stages.includes("E.isolation_uncertainty_or"));
  assert.ok(stages.includes("E.isolation_gmail_or"));
  assert.ok(stages.includes("E.isolation_gmail_notIn_contaminated"));
  assert.equal(stages.includes("D.isolation_full"), false);
});
