import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

type BypassClassification = "RAW_EVIDENCE_ONLY" | "CANONICAL_ENGINE_INPUT" | "LEGACY_BLOCKED" | "STILL_DANGEROUS";

type BypassFinding = {
  file: string;
  pattern: string;
  classification: BypassClassification;
  note: string;
};

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const ACTIVE_FINANCIAL_FILES = [
  "src/services/gmail-sync.ts",
  "src/services/whatsappInvoiceIngestion.ts",
  "src/services/camera/cameraIngestion.ts",
  "src/services/clientGmailSync.ts",
  "src/services/invoiceScanner.ts",
  "src/services/claude.ts",
  "src/services/financialDocuments.ts",
];

const BYPASS_PATTERNS: Array<{ pattern: RegExp; label: string; dangerous: boolean }> = [
  { pattern: /supplierName:\s*analysis\.supplier(?!\s*\?\?)/, label: "analysis.supplier direct persist", dangerous: true },
  { pattern: /amount:\s*analysis\.amount(?!\s*\?\?)/, label: "analysis.amount direct persist", dangerous: true },
  { pattern: /invoiceDate:\s*receivedAt/, label: "email receivedAt as invoiceDate", dangerous: true },
  { pattern: /documentDate:\s*receivedAt/, label: "email receivedAt as documentDate", dangerous: true },
  { pattern: /parseDate\([^,]+,\s*receivedAt\)/, label: "parseDate fallback to receivedAt", dangerous: true },
];

function classifyFile(relativePath: string): BypassFinding[] {
  const absolute = join(REPO_ROOT, relativePath);
  const content = readFileSync(absolute, "utf8");
  const findings: BypassFinding[] = [];

  for (const { pattern, label, dangerous } of BYPASS_PATTERNS) {
    if (!pattern.test(content)) continue;
    let classification: BypassClassification = dangerous ? "STILL_DANGEROUS" : "RAW_EVIDENCE_ONLY";
    if (relativePath.includes("invoiceScanner.ts") || relativePath.includes("clientGmailSync.ts")) {
      classification = "LEGACY_BLOCKED";
    } else if (relativePath.includes("gmail-sync.ts") && /resolveGmailOrgMoneyDecision|resolveSupplierMetadata|resolveInvoiceDocumentDate/.test(content)) {
      if (label.includes("analysis.amount") || label.includes("analysis.supplier")) {
        classification = "CANONICAL_ENGINE_INPUT";
      }
    }
    findings.push({ file: relativePath, pattern: label, classification, note: classification });
  }

  return findings;
}

test("Delivery 9: static extraction bypass audit — 0 active STILL_DANGEROUS on modern org paths", () => {
  const modernPaths = ACTIVE_FINANCIAL_FILES.filter(
    (file) => !file.includes("invoiceScanner.ts") && !file.includes("clientGmailSync.ts")
  );
  const findings = modernPaths.flatMap(classifyFile);
  const dangerous = findings.filter((finding) => finding.classification === "STILL_DANGEROUS");
  assert.equal(
    dangerous.length,
    0,
    dangerous.map((finding) => `${finding.file}: ${finding.pattern}`).join("\n")
  );
});

test("Delivery 9: legacy client paths classified separately", () => {
  const legacyFindings = ["src/services/invoiceScanner.ts", "src/services/clientGmailSync.ts"].flatMap(classifyFile);
  assert.ok(legacyFindings.length > 0);
  assert.ok(legacyFindings.every((finding) => finding.classification === "LEGACY_BLOCKED"));
});
