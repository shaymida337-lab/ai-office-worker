import { config } from "dotenv";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local") });

const url = process.env.PROD_DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const ORG = process.argv[2] ?? "cmqxujfuj034ndy2czu9tjoko";

try {
  const { loadSttVocabulary } = await import("../dist/services/sttAccuracy/sttVocabulary.js");
  const { processTranscriptAccuracy } = await import("../dist/services/sttAccuracy/sttNormalizer.js");
  const { correctBusinessNamesInTranscript } = await import("../dist/services/sttAccuracy/sttNameCorrection.js");

  const vocabulary = await loadSttVocabulary(ORG);
  const badTokens = vocabulary.supplierNames.filter((n) => /normalizeDetected|\(/.test(n));
  correctBusinessNamesInTranscript("שלום נטלי", vocabulary);
  const result = await processTranscriptAccuracy({
    organizationId: ORG,
    rawTranscript: "כמה שילמתי החודש",
    vocabulary,
    skipClarification: true,
  });

  console.log(
    JSON.stringify({
      orgId: ORG,
      corruptedSupplierRows: badTokens.slice(0, 5),
      supplierNameCount: vocabulary.supplierNames.length,
      hasBadToken: vocabulary.supplierNames.some((n) => /normalizeDetected|\(/.test(n)),
      normalizedTranscript: result.normalizedTranscript,
      confidence: result.confidence,
      ok: true,
    })
  );
} catch (err) {
  console.log(JSON.stringify({ ok: false, name: err.name, message: err.message }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
