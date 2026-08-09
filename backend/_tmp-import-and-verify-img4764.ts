/**
 * Import IMG_4764 from prod signed upload into local _tmp-verify, then run analyzeInvoiceFile.
 * Uses env files only (no Render Jobs). Prints only result fields needed for gate.
 */
import { config as loadEnv } from "dotenv";
import { createHmac, createHash } from "crypto";
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
const EXPECTED_SHA = "29017b1e50a4f2ebf279b78e045970c6ff0e7609efdeddedfce118031214453f";
const PATHNAME = "/uploads/camera-invoices/1784111581912_IMG_4764.png";
const API = process.env.BACKEND_URL?.trim() || "https://ai-office-worker-backend.onrender.com";
const OUT = join(process.cwd(), "_tmp-verify", "IMG_4764.png");

async function fetchRenderEnvKeys(keys: string[]): Promise<Record<string, string>> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) return {};
  const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  const wanted = new Set(keys);
  const found: Record<string, string> = {};
  let cursor: string | null = null;
  let pages = 0;
  do {
    pages += 1;
    if (pages > 30) break;
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars?${qs}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Render env ${res.status}`);
    const body = (await res.json()) as Array<{ envVar?: { key?: string; value?: string }; cursor?: string }>;
    for (const item of body) {
      const k = item.envVar?.key;
      const v = item.envVar?.value;
      if (k && v && wanted.has(k)) found[k] = v;
    }
    cursor = body.length ? (body.at(-1)?.cursor ?? null) : null;
    if (Object.keys(found).length >= wanted.size) break;
  } while (cursor);
  return found;
}

function sign(pathname: string, org: string, secret: string) {
  const exp = Date.now() + 4 * 60 * 60 * 1000;
  const sig = createHmac("sha256", secret).update(`${pathname}|${org}|${exp}`).digest("hex");
  const i = pathname.lastIndexOf("/");
  return `${pathname.slice(0, i)}/${encodeURIComponent(pathname.slice(i + 1))}?org=${encodeURIComponent(org)}&exp=${exp}&sig=${sig}`;
}

async function importImage(): Promise<Buffer> {
  mkdirSync(join(process.cwd(), "_tmp-verify"), { recursive: true });
  if (existsSync(OUT)) {
    const buf = readFileSync(OUT);
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha === EXPECTED_SHA) {
      console.log("using_cached_image", OUT, "bytes", buf.length);
      return buf;
    }
    console.log("cached_sha_mismatch", sha, "reimporting");
  }

  let jwtSecret = process.env.JWT_SECRET?.trim() || "";
  let anthropic = process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (!jwtSecret || !anthropic) {
    console.log("fetching_missing_env_from_render…");
    const env = await fetchRenderEnvKeys(["JWT_SECRET", "ANTHROPIC_API_KEY"]);
    jwtSecret = jwtSecret || env.JWT_SECRET || "";
    anthropic = anthropic || env.ANTHROPIC_API_KEY || "";
  }
  if (!jwtSecret) throw new Error("JWT_SECRET unavailable");
  if (anthropic) process.env.ANTHROPIC_API_KEY = anthropic;

  const url = `${API}${sign(PATHNAME, SHAY, jwtSecret)}`;
  console.log("downloading…");
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("download_status", res.status, "bytes", buf.length);
  if (!res.ok) {
    throw new Error(`download_failed status=${res.status} body=${buf.toString("utf8").slice(0, 180)}`);
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== EXPECTED_SHA) {
    throw new Error(`sha_mismatch got=${sha} expected=${EXPECTED_SHA}`);
  }
  writeFileSync(OUT, buf);
  console.log("imported", OUT);
  return buf;
}

async function main() {
  const buf = await importImage();
  if (!process.env.ANTHROPIC_API_KEY) {
    const env = await fetchRenderEnvKeys(["ANTHROPIC_API_KEY"]);
    if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");

  const { analyzeInvoiceFile } = await import("./src/services/claude.js");
  const result = await analyzeInvoiceFile({
    fileBase64: buf.toString("base64"),
    mimeType: "image/png",
    filename: "IMG_4764.png",
  });

  const supplier = result.supplier ?? null;
  const amount = result.amount ?? result.totalAmount ?? null;
  const date = result.date ?? null;
  const pass =
    supplier === "מה יוסי פיצוחי" &&
    !/וולט|wolt/i.test(supplier) &&
    Number(amount) === 30 &&
    (date === "2026-07-03" || date === "03/07/2026" || date === "2026-03-07");

  console.log(
    JSON.stringify(
      {
        pass,
        supplier,
        amount,
        date,
        documentType: result.documentType,
        invoiceNumber: result.invoiceNumber,
        ocrConfidence: result.ocrConfidence,
      },
      null,
      2,
    ),
  );
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
