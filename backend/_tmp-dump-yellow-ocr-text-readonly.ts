/**
 * READ-ONLY: dump nested OCR/PDF text + analysis for Yellow/Isracard FDR
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const FDR_ID = "cms1nvpvp00pbjn2cwks9a78b";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const prodUrl = process.env.PROD_DATABASE_URL ?? "";
if (!prodUrl || process.env.ALLOW_REMOTE_READONLY_REPORT !== "1") {
  console.error(JSON.stringify({ error: "need PROD + ALLOW" }));
  process.exit(2);
}

const u = new URL(prodUrl);
u.searchParams.set("pgbouncer", "true");
const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

function walkStrings(node, path, acc, depth = 0) {
  if (depth > 8 || node == null) return;
  if (typeof node === "string") {
    if (node.length >= 20) {
      acc.push({
        path,
        length: node.length,
        hasYellow: /yellow|ילו|יילו/i.test(node),
        hasIsracard: /ישראכרט|isracard/i.test(node),
        has418: /418([.,]39)?/.test(node),
        preview: node.slice(0, 1500),
      });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.slice(0, 30).forEach((v, i) => walkStrings(v, `${path}[${i}]`, acc, depth + 1));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      // skip huge binary-ish
      if (k.toLowerCase().includes("base64") || k.toLowerCase().includes("image")) continue;
      walkStrings(v, path ? `${path}.${k}` : k, acc, depth + 1);
    }
  }
}

async function main() {
  const fdr = await prisma.financialDocumentReview.findFirst({
    where: { id: FDR_ID, organizationId: ORG },
  });
  if (!fdr) {
    console.log(JSON.stringify({ error: "FDR not found" }));
    return;
  }
  const gsi = await prisma.gmailScanItem.findFirst({
    where: { organizationId: ORG, gmailMessageId: fdr.gmailMessageId || undefined },
  });

  const stringHits = [];
  walkStrings(fdr.parsedFieldsJson, "parsedFieldsJson", stringHits);
  walkStrings(fdr.rawAnalysis, "rawAnalysis", stringHits);
  if (gsi) {
    walkStrings(gsi.parsedFieldsJson, "gsi.parsedFieldsJson", stringHits);
    walkStrings(gsi.rawAnalysis, "gsi.rawAnalysis", stringHits);
  }

  // Prefer longest text with isracard or yellow
  const ranked = [...stringHits].sort((a, b) => {
    const score = (x) => (x.hasIsracard ? 100000 : 0) + (x.hasYellow ? 50000 : 0) + x.length;
    return score(b) - score(a);
  });

  const best = ranked[0] || null;
  let lineHits = [];
  if (best?.preview || best?.length) {
    // get full text again from path
    const parts = best.path.split(".");
    let node = best.path.startsWith("gsi.")
      ? best.path.includes("parsed")
        ? gsi?.parsedFieldsJson
        : gsi?.rawAnalysis
      : best.path.startsWith("parsed")
        ? fdr.parsedFieldsJson
        : fdr.rawAnalysis;
    // fragile path walk - better re-extract by searching all texts that have isracard
  }

  const fullTexts = stringHits.filter((s) => s.hasIsracard || s.hasYellow || s.length > 500);
  const textsWithContext = fullTexts.map((s) => {
    // recover full string via JSON stringify search is hard; re-walk for exact path
    return s;
  });

  // Deep get by path
  function getByPath(root, path) {
    const clean = path.replace(/^gsi\./, "").replace(/^parsedFieldsJson\./, "").replace(/^rawAnalysis\./, "");
    let base = path.startsWith("gsi.parsed")
      ? gsi?.parsedFieldsJson
      : path.startsWith("gsi.raw")
        ? gsi?.rawAnalysis
        : path.startsWith("parsedFieldsJson")
          ? fdr.parsedFieldsJson
          : fdr.rawAnalysis;
    // path like rawAnalysis.analysis.ocrText - strip first segment
    const segs = path.split(".");
    let node = path.startsWith("gsi")
      ? path.includes("parsedFieldsJson")
        ? gsi?.parsedFieldsJson
        : gsi?.rawAnalysis
      : path.startsWith("parsedFieldsJson")
        ? fdr.parsedFieldsJson
        : fdr.rawAnalysis;
    const start = path.startsWith("gsi")
      ? path.startsWith("gsi.parsedFieldsJson")
        ? 2
        : 2
      : 1;
    for (let i = start; i < segs.length; i++) {
      const seg = segs[i];
      const m = seg.match(/^(.+)\[(\d+)\]$/);
      if (!node) return null;
      if (m) node = node[m[1]]?.[Number(m[2])];
      else node = node[seg];
    }
    return typeof node === "string" ? node : null;
  }

  const detailedTexts = [];
  for (const s of ranked.slice(0, 12)) {
    const full = getByPath(null, s.path);
    const text = full || s.preview;
    const lines = text.split(/\r?\n/);
    const isracard = [];
    const yellow = [];
    lines.forEach((line, i) => {
      if (/ישראכרט|isracard/i.test(line)) {
        isracard.push({ i, prev: lines[i - 1] || null, line, next: lines[i + 1] || null });
      }
      if (/yellow|ילו|יילו|YELLOW/i.test(line)) {
        yellow.push({ i, prev: lines[i - 1] || null, line, next: lines[i + 1] || null });
      }
    });
    detailedTexts.push({
      path: s.path,
      length: full?.length ?? s.length,
      hasYellow: /yellow|ילו|יילו/i.test(text),
      hasIsracard: /ישראכרט|isracard/i.test(text),
      isracardLines: isracard.slice(0, 25),
      yellowLines: yellow.slice(0, 25),
      head: text.slice(0, 2000),
      mid: text.slice(Math.max(0, Math.floor(text.length / 2) - 500), Math.floor(text.length / 2) + 500),
    });
  }

  // analysis object summary
  const analysis = (fdr.rawAnalysis as any)?.analysis ?? null;
  const classification = (fdr.rawAnalysis as any)?.classification ?? null;

  const out = {
    fdrId: fdr.id,
    supplierName: fdr.supplierName,
    amount: fdr.totalAmount,
    fileName: fdr.fileName,
    uncertaintyReason: fdr.uncertaintyReason,
    analysisKeys: analysis && typeof analysis === "object" ? Object.keys(analysis) : null,
    analysisSupplier: analysis?.supplierName ?? analysis?.supplier ?? null,
    analysisAmount: analysis?.amount ?? analysis?.totalAmount ?? null,
    analysisDocumentType: analysis?.documentType ?? null,
    classification,
    stringHitSummary: ranked.slice(0, 20).map((s) => ({
      path: s.path,
      length: s.length,
      hasYellow: s.hasYellow,
      hasIsracard: s.hasIsracard,
      has418: s.has418,
    })),
    detailedTexts,
    gsiDecisionReason: gsi?.decisionReason ?? null,
    gsiSupplier: gsi?.supplierName ?? null,
  };

  // fix typo amount
  out.amount = fdr.totalAmount;

  writeFileSync(join(process.cwd(), "_tmp-yellow-text-dump.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ error: String(e?.message ?? e) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
