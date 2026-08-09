/**
 * READ-ONLY: diagnose Yellow invoice mis-extracted as ישראכרט / 418.39
 * Org: kedmashopd1 (cmqw27e43002bm92bmf9mjy1n)
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW_REMOTE_READONLY_REPORT=1" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

function pickText(parsed: any): string {
  if (!parsed || typeof parsed !== "object") return "";
  const keys = [
    "ocrText",
    "pdfText",
    "fullText",
    "text",
    "rawText",
    "extractedText",
    "documentText",
  ];
  for (const k of keys) {
    if (typeof parsed[k] === "string" && parsed[k].trim()) return parsed[k];
  }
  // nested common shapes
  for (const nest of ["ocr", "extraction", "pdf", "claude", "analysis"]) {
    const n = parsed[nest];
    if (!n || typeof n !== "object") continue;
    for (const k of keys) {
      if (typeof n[k] === "string" && n[k].trim()) return n[k];
    }
  }
  return "";
}

function findIsracardContexts(text: string) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/ישראכרט|isracard|visa|mastercard/i.test(lines[i])) {
      hits.push({
        lineIndex: i,
        line: lines[i],
        prev: lines[i - 1] ?? null,
        next: lines[i + 1] ?? null,
      });
    }
  }
  return hits;
}

function findYellowContexts(text: string) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/yellow|ילו|יילו|יאללו/i.test(lines[i])) {
      hits.push({
        lineIndex: i,
        line: lines[i],
        prev: lines[i - 1] ?? null,
        next: lines[i + 1] ?? null,
      });
    }
  }
  return hits;
}

async function main() {
  const since = new Date(Date.now() - 6 * 3600e3);

  const fdrs = await prisma.financialDocumentReview.findMany({
    where: {
      organizationId: ORG,
      OR: [
        { createdAt: { gte: since } },
        { supplierName: { contains: "ישראכרט" } },
        { totalAmount: 418.39 },
        { fileName: { contains: "pairzon", mode: "insensitive" } },
        { fileName: { contains: "yellow", mode: "insensitive" } },
        { subject: { contains: "yellow", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const gsis = await prisma.gmailScanItem.findMany({
    where: {
      organizationId: ORG,
      OR: [
        { createdAt: { gte: since } },
        { supplierName: { contains: "ישראכרט" } },
        { amount: 418.39 },
        { attachmentFilename: { contains: "pairzon", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Focus candidates: amount 418.39 or isracard supplier recently
  const focus = fdrs.filter(
    (f) =>
      f.totalAmount === 418.39 ||
      (f.supplierName || "").includes("ישראכרט") ||
      (f.fileName || "").toLowerCase().includes("pairzon") ||
      (f.createdAt >= new Date("2026-07-26T10:34:00Z") &&
        ["tax_invoice", "invoice", "payment_request"].includes(f.documentType || ""))
  );

  const detailed = focus.map((f) => {
    const parsed = f.parsedFieldsJson as any;
    const rawAnalysis = f.rawAnalysis as any;
    const textFromParsed = pickText(parsed);
    const textFromRaw =
      typeof rawAnalysis === "string"
        ? rawAnalysis
        : pickText(rawAnalysis) ||
          (typeof rawAnalysis?.content === "string" ? rawAnalysis.content : "");
    const text = textFromParsed || textFromRaw || "";

    const supplierBits = {
      supplierName: f.supplierName,
      parsedSupplierName: parsed?.supplierName ?? parsed?.supplier?.name ?? null,
      supplierCandidates:
        parsed?.supplierCandidates ??
        parsed?.supplier?.candidates ??
        parsed?.candidates?.suppliers ??
        parsed?.extraction?.supplierCandidates ??
        null,
      supplierMethod:
        parsed?.supplierMethod ??
        parsed?.supplier?.method ??
        parsed?.supplierSource ??
        parsed?.extraction?.supplierMethod ??
        parsed?.supplier_resolved ??
        null,
      supplierResolved:
        parsed?.supplier_resolved ??
        parsed?.supplierResolved ??
        parsed?.resolution?.supplier ??
        null,
      sir:
        parsed?.sir ??
        parsed?.supplierIdentity ??
        parsed?.supplier_identity ??
        null,
    };

    return {
      id: f.id,
      source: f.source,
      gmailMessageId: f.gmailMessageId,
      fileName: f.fileName,
      subject: f.subject,
      sender: f.sender,
      supplierName: f.supplierName,
      totalAmount: f.totalAmount,
      documentType: f.documentType,
      reviewStatus: f.reviewStatus,
      uncertaintyReason: f.uncertaintyReason,
      confidenceScore: f.confidenceScore,
      documentFingerprint: f.documentFingerprint,
      sourceFingerprint: f.sourceFingerprint,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      supplierBits,
      parsedTopLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      rawAnalysisTopLevelKeys:
        rawAnalysis && typeof rawAnalysis === "object" ? Object.keys(rawAnalysis) : [],
      textLength: text.length,
      textPreview: text.slice(0, 2500),
      textHasYellow: /yellow|ילו|יילו/i.test(text),
      textHasIsracard: /ישראכרט|isracard/i.test(text),
      isracardLineHits: findIsracardContexts(text).slice(0, 20),
      yellowLineHits: findYellowContexts(text).slice(0, 20),
      amount418Contexts: text
        .split(/\r?\n/)
        .map((line, lineIndex) => ({ lineIndex, line }))
        .filter((x) => /418([.,]39)?|418\.39|418,39/.test(x.line))
        .slice(0, 15),
      parsedFieldsJsonRelevant: parsed
        ? {
            supplierName: parsed.supplierName ?? null,
            amount: parsed.amount ?? parsed.totalAmount ?? null,
            documentType: parsed.documentType ?? null,
            supplier: parsed.supplier ?? null,
            extraction: parsed.extraction
              ? {
                  method: parsed.extraction.method ?? parsed.extraction.source ?? null,
                  supplier: parsed.extraction.supplier ?? null,
                  supplierMethod: parsed.extraction.supplierMethod ?? null,
                  supplierCandidates: parsed.extraction.supplierCandidates ?? null,
                }
              : null,
            ocr:
              parsed.ocr && typeof parsed.ocr === "object"
                ? {
                    engine: parsed.ocr.engine ?? parsed.ocr.provider ?? null,
                    confidence: parsed.ocr.confidence ?? null,
                    textLen: typeof parsed.ocr.text === "string" ? parsed.ocr.text.length : null,
                  }
                : null,
            pdf:
              parsed.pdf && typeof parsed.pdf === "object"
                ? {
                    textLen: typeof parsed.pdf.text === "string" ? parsed.pdf.text.length : null,
                    method: parsed.pdf.method ?? null,
                  }
                : null,
            supplier_resolved: parsed.supplier_resolved ?? null,
            decisionReason: parsed.decisionReason ?? null,
            gates: parsed.gates ?? parsed.gateSnapshots ?? null,
          }
        : null,
      fullParsedFieldsJson: parsed,
      rawAnalysisSlim:
        rawAnalysis && typeof rawAnalysis === "object"
          ? {
              keys: Object.keys(rawAnalysis),
              supplierName: rawAnalysis.supplierName ?? rawAnalysis.supplier ?? null,
              amount: rawAnalysis.amount ?? rawAnalysis.totalAmount ?? null,
              method: rawAnalysis.method ?? rawAnalysis.source ?? rawAnalysis.engine ?? null,
              textLen: pickText(rawAnalysis).length,
            }
          : typeof rawAnalysis === "string"
            ? { stringLen: rawAnalysis.length, preview: rawAnalysis.slice(0, 500) }
            : rawAnalysis,
    };
  });

  // Duplicate check among recent invoice-like FDRs
  const invoiceLike = fdrs.filter(
    (f) =>
      f.createdAt >= new Date("2026-07-26T10:34:00Z") &&
      !String(f.uncertaintyReason || "").startsWith("junk_filter")
  );

  const dupPairs = [];
  for (let i = 0; i < invoiceLike.length; i++) {
    for (let j = i + 1; j < invoiceLike.length; j++) {
      const a = invoiceLike[i];
      const b = invoiceLike[j];
      dupPairs.push({
        a: { id: a.id, file: a.fileName, supplier: a.supplierName, amount: a.totalAmount, fp: a.documentFingerprint, sfp: a.sourceFingerprint, gmail: a.gmailMessageId },
        b: { id: b.id, file: b.fileName, supplier: b.supplierName, amount: b.totalAmount, fp: b.documentFingerprint, sfp: b.sourceFingerprint, gmail: b.gmailMessageId },
        sameDocumentFingerprint: a.documentFingerprint === b.documentFingerprint,
        sameSourceFingerprint: a.sourceFingerprint === b.sourceFingerprint,
        sameGmailMessageId: a.gmailMessageId && a.gmailMessageId === b.gmailMessageId,
        sameAmount: a.totalAmount != null && a.totalAmount === b.totalAmount,
        sameSupplier: a.supplierName && a.supplierName === b.supplierName,
      });
    }
  }

  const out = {
    now: new Date().toISOString(),
    orgId: ORG,
    focusCount: focus.length,
    detailed,
    recentInvoiceLikeCards: invoiceLike.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      subject: f.subject,
      supplierName: f.supplierName,
      totalAmount: f.totalAmount,
      documentType: f.documentType,
      uncertaintyReason: f.uncertaintyReason,
      gmailMessageId: f.gmailMessageId,
      documentFingerprint: f.documentFingerprint,
      sourceFingerprint: f.sourceFingerprint,
      createdAt: f.createdAt.toISOString(),
    })),
    duplicateComparison: dupPairs,
    relatedGsi: gsis.map((g) => ({
      id: g.id,
      gmailMessageId: g.gmailMessageId,
      attachmentFilename: g.attachmentFilename,
      supplierName: g.supplierName,
      amount: g.amount,
      documentType: g.documentType,
      decisionReason: g.decisionReason,
      createdAt: g.createdAt.toISOString(),
    })),
  };

  writeFileSync(join(process.cwd(), "_tmp-yellow-isracard-diag.json"), JSON.stringify(out, null, 2), "utf8");
  // Also write a compact report without full parsed dump for console
  const compact = {
    ...out,
    detailed: out.detailed.map((d) => {
      const { fullParsedFieldsJson, ...rest } = d;
      return {
        ...rest,
        parsedFieldsJsonSize: fullParsedFieldsJson ? JSON.stringify(fullParsedFieldsJson).length : 0,
      };
    }),
  };
  console.log(JSON.stringify(compact, null, 2));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
