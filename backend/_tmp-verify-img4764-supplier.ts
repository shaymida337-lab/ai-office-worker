/**
 * Download IMG_4764 from prod (signed upload) and re-run analyzeInvoiceFile
 * with camera settings (skipTesseract) to verify supplier extraction.
 */
import { config as loadEnv } from "dotenv";
import { createHmac } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}
if (existsSync(join(process.cwd(), ".env.render-db.tmp"))) {
  loadEnv({ path: join(process.cwd(), ".env.render-db.tmp"), override: true });
}

const SHAY = "cmpjd7j7e0001bl5tzv049rxb";
const PATHNAME = "/uploads/camera-invoices/1784111581912_IMG_4764.png";
const API = "https://ai-office-worker-backend.onrender.com";
const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";

async function fetchRenderEnv(keys: string[]): Promise<Map<string, string>> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  const wanted = new Set(keys);
  const found = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars?${qs}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Render env ${res.status}`);
    const body = (await res.json()) as Array<{ envVar?: { key?: string; value?: string }; cursor?: string }>;
    for (const item of body) {
      const k = item.envVar?.key;
      const v = item.envVar?.value;
      if (k && v && wanted.has(k)) found.set(k, v);
    }
    cursor = body.at(-1)?.cursor ?? null;
    if (!body.length) cursor = null;
  } while (cursor && found.size < wanted.size);
  return found;
}

function signLocalUploadUrl(pathname: string, organizationId: string, jwtSecret: string, now = Date.now()): string {
  const expiresAt = now + 4 * 60 * 60 * 1000;
  const signature = createHmac("sha256", jwtSecret)
    .update(`${pathname}|${organizationId}|${expiresAt}`)
    .digest("hex");
  const separatorIndex = pathname.lastIndexOf("/");
  const dirPart = pathname.slice(0, separatorIndex);
  const fileName = pathname.slice(separatorIndex + 1);
  return `${dirPart}/${encodeURIComponent(fileName)}?org=${encodeURIComponent(organizationId)}&exp=${expiresAt}&sig=${signature}`;
}

async function main() {
  const outDir = join(process.cwd(), "_tmp-verify");
  mkdirSync(outDir, { recursive: true });
  const localPath = join(outDir, "IMG_4764.png");

  if (!existsSync(localPath)) {
    const env = await fetchRenderEnv(["JWT_SECRET", "ANTHROPIC_API_KEY"]);
    const jwtSecret = env.get("JWT_SECRET");
    const anthropic = env.get("ANTHROPIC_API_KEY");
    if (!jwtSecret) throw new Error("JWT_SECRET not found on Render");
    if (anthropic && !process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = anthropic;
    }
    const signed = signLocalUploadUrl(PATHNAME, SHAY, jwtSecret);
    const url = `${API}${signed}`;
    console.log("Downloading signed upload…");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(localPath, buf);
    console.log("Saved", localPath, "bytes", buf.length);
  } else {
    console.log("Using cached", localPath);
    if (!process.env.ANTHROPIC_API_KEY) {
      const env = await fetchRenderEnv(["ANTHROPIC_API_KEY"]);
      const anthropic = env.get("ANTHROPIC_API_KEY");
      if (anthropic) process.env.ANTHROPIC_API_KEY = anthropic;
    }
  }

  // Ensure config picks up key (claude module reads at import via config)
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const { analyzeInvoiceFile } = await import("./src/services/claude.js");
  const fileBase64 = readFileSync(localPath).toString("base64");

  console.log("Running analyzeInvoiceFile skipTesseract=true …");
  const result = await analyzeInvoiceFile({
    fileBase64,
    mimeType: "image/png",
    filename: "IMG_4764.png",
    skipTesseract: true,
  });

  console.log(
    JSON.stringify(
      {
        supplier: result.supplier,
        amount: result.amount,
        totalAmount: result.totalAmount,
        date: result.date,
        documentType: result.documentType,
        invoiceNumber: result.invoiceNumber,
        ocrConfidence: result.ocrConfidence,
        hasOcrText: Boolean(result.ocrText),
      },
      null,
      2,
    ),
  );

  const ok =
    typeof result.supplier === "string" &&
    /יוסי|פיצוחי/.test(result.supplier) &&
    !/וולט|wolt/i.test(result.supplier);
  console.log(ok ? "PASS supplier" : "FAIL supplier", result.supplier);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
