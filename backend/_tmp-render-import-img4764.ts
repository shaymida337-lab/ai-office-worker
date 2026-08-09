/**
 * One-shot import: run a short Render job that prints sha256 + base64 of IMG_4764,
 * then reconstruct locally under _tmp-verify/.
 */
import { config as loadEnv } from "dotenv";
import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const EXPECTED_SHA = "29017b1e50a4f2ebf279b78e045970c6ff0e7609efdeddedfce118031214453f";
const REL = "uploads/camera-invoices/1784111581912_IMG_4764.png";
const OUT = join(process.cwd(), "_tmp-verify", "IMG_4764.png");

async function main() {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const startCommand = [
    "node",
    "-e",
    `"const fs=require('fs');const p='${REL}';const b=fs.readFileSync(p);const h=require('crypto').createHash('sha256').update(b).digest('hex');console.log('IMG4764_SHA='+h);console.log('IMG4764_B64_BEGIN');console.log(b.toString('base64'));console.log('IMG4764_B64_END');"`,
  ].join(" ");

  console.log("creating_job…");
  const create = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ startCommand }),
    signal: AbortSignal.timeout(30_000),
  });
  const createText = await create.text();
  console.log("create_status", create.status);
  if (!create.ok) {
    throw new Error(`job_create_failed ${create.status} ${createText.slice(0, 500)}`);
  }
  const created = JSON.parse(createText) as { id?: string; job?: { id?: string } };
  const jobId = created.id ?? created.job?.id;
  if (!jobId) throw new Error(`no job id: ${createText.slice(0, 300)}`);
  console.log("job_id", jobId);

  let finished = false;
  let status = "";
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await st.json()) as { status?: string; job?: { status?: string } };
    status = body.status ?? body.job?.status ?? "";
    console.log("poll", i, status);
    if (["succeeded", "failed", "canceled", "cancelled"].includes(String(status).toLowerCase())) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error(`job_timeout status=${status}`);

  // Try job logs endpoint variants
  const logUrls = [
    `https://api.render.com/v1/jobs/${jobId}/logs`,
    `https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}/logs`,
  ];
  let logs = "";
  for (const url of logUrls) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    console.log("logs", url, res.status);
    if (res.ok) {
      logs = await res.text();
      break;
    }
  }
  if (!logs.includes("IMG4764_B64_BEGIN")) {
    throw new Error(`logs_missing_payload status_final=${status} sample=${logs.slice(0, 400)}`);
  }
  const b64 = logs.split("IMG4764_B64_BEGIN")[1]?.split("IMG4764_B64_END")[0]?.replace(/\s+/g, "") ?? "";
  const buf = Buffer.from(b64, "base64");
  const sha = createHash("sha256").update(buf).digest("hex");
  console.log("imported_bytes", buf.length, "sha", sha);
  if (sha !== EXPECTED_SHA) throw new Error(`sha_mismatch ${sha}`);
  mkdirSync(join(process.cwd(), "_tmp-verify"), { recursive: true });
  writeFileSync(OUT, buf);
  console.log("wrote", OUT);
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
