import test from "node:test";
import assert from "node:assert/strict";
import { buildWeakDocumentFallbackFingerprint, computeCanonicalFingerprint } from "./sharedMatcher.js";

const base = {
  organizationId: "org-1",
  supplierName: "חברת החשמל",
  supplierTaxId: "5200000472",
  invoiceNumber: "INV-1001",
  totalAmount: 350.5,
  documentDate: new Date("2026-06-15T00:00:00Z"),
  documentType: "tax_invoice",
  fileSha256: null as string | null,
};

test("unified fingerprint: same document gets the same key regardless of ingestion source", () => {
  // הטביעה הקנונית לא כוללת שדות פר-מקור (sender/fileName/source) —
  // אותו מסמך ממייל, וואטסאפ או מצלמה מקבל את אותו מפתח.
  const viaGmail = computeCanonicalFingerprint({ ...base });
  const viaWhatsApp = computeCanonicalFingerprint({ ...base });
  assert.equal(viaGmail.fingerprint, viaWhatsApp.fingerprint);
  assert.notEqual(viaGmail.fingerprint, null);

  // עם אותו קובץ (SHA256 זהה) — טיר file, זהה בין מסלולים (F5: מצלמה עכשיו שולחת sha)
  const sha = "a".repeat(64);
  const fileA = computeCanonicalFingerprint({ ...base, fileSha256: sha });
  const fileB = computeCanonicalFingerprint({ ...base, supplierName: "שם אחר בגלל OCR", fileSha256: sha });
  assert.equal(fileA.tier, "file");
  assert.equal(fileA.fingerprint, fileB.fingerprint);
});

test("legitimate near-duplicates are NOT merged (bidirectional safety)", () => {
  // שתי חשבוניות שונות מאותו ספק באותו סכום — מספרי חשבונית שונים → מפתחות שונים
  const invoiceA = computeCanonicalFingerprint({ ...base, invoiceNumber: "INV-1001" });
  const invoiceB = computeCanonicalFingerprint({ ...base, invoiceNumber: "INV-1002" });
  assert.notEqual(invoiceA.fingerprint, invoiceB.fingerprint);

  // שני חיובים חודשיים זהים (ספק+סכום זהים, חודשים שונים, בלי מספר חשבונית) → מפתחות שונים
  const june = computeCanonicalFingerprint({
    ...base, invoiceNumber: null, supplierTaxId: null, documentDate: new Date("2026-06-01T00:00:00Z"),
  });
  const july = computeCanonicalFingerprint({
    ...base, invoiceNumber: null, supplierTaxId: null, documentDate: new Date("2026-07-01T00:00:00Z"),
  });
  assert.notEqual(june.fingerprint, july.fingerprint);
});

test("true duplicate IS caught: identical identity fields converge", () => {
  const first = computeCanonicalFingerprint({ ...base, invoiceNumber: null, supplierTaxId: null });
  const second = computeCanonicalFingerprint({ ...base, invoiceNumber: null, supplierTaxId: null });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.isStrongEnoughForAutoSaveDedup, true);
});

test("weak identity never auto-blocks (conservative rule)", () => {
  const weak = computeCanonicalFingerprint({
    organizationId: "org-1",
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    totalAmount: null,
    documentDate: null,
    documentType: "document",
    fileSha256: null,
  });
  assert.equal(weak.fingerprint, null);
  assert.equal(weak.isStrongEnoughForAutoSaveDedup, false);
});

test("weak fallback fingerprint separates distinct sources but is stable per source (F7)", () => {
  const legacy = "legacy-fp";
  const msgA = buildWeakDocumentFallbackFingerprint({ organizationId: "org-1", legacyFingerprint: legacy, uniqueHint: "gmail-msg-A" });
  const msgArepeat = buildWeakDocumentFallbackFingerprint({ organizationId: "org-1", legacyFingerprint: legacy, uniqueHint: "gmail-msg-A" });
  const msgB = buildWeakDocumentFallbackFingerprint({ organizationId: "org-1", legacyFingerprint: legacy, uniqueHint: "gmail-msg-B" });
  // אותה הודעה שנסרקת שוב — אותו מפתח (מתעדכנת, לא מתפצלת)
  assert.equal(msgA, msgArepeat);
  // שתי הודעות שונות חסרות-זהות — מפתחות שונים (לא דורסות זו את זו)
  assert.notEqual(msgA, msgB);
  // בידוד ארגוני נשמר
  const otherOrg = buildWeakDocumentFallbackFingerprint({ organizationId: "org-2", legacyFingerprint: legacy, uniqueHint: "gmail-msg-A" });
  assert.notEqual(msgA, otherOrg);
});
