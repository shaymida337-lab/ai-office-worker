import { config as loadEnv } from "dotenv";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const REL = "uploads/camera-invoices/1784111581912_IMG_4764.png";
const EXPECTED_SHA = "29017b1e50a4f2ebf279b78e045970c6ff0e7609efdeddedfce118031214453f";
const OUT = join(process.cwd(), "_tmp-verify", "IMG_4764.png");

async function main() {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("no key");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Discover service root / disk. Job shares? Try find + base64 to a small meta-first approach:
  // write sha and size only first.
  const startCommand = [
    "bash",
    "-lc",
    JSON.stringify(
      [
        "set -e",
        "pwd",
        "ls -la",
        "ls -la uploads/camera-invoices 2>/dev/null | head -n 30 || true",
        `if [ -f ${REL} ]; then echo FOUND_REL; elif [ -f /opt/render/project/src/${REL} ]; then echo FOUND_OPT; REL=/opt/render/project/src/${REL}; else echo MISSING; find /opt/render -name '1784111581912_IMG_4764.png' 2>/dev/null | head; exit 2; fi`,
        `node -e "const fs=require('fs');const p=process.env.REL||'${REL}';const b=fs.readFileSync(p);const h=require('crypto').createHash('sha256').update(b).digest('hex');console.log('IMG4764_SHA='+h);console.log('IMG4764_LEN='+b.length);console.log('IMG4764_B64_BEGIN');process.stdout.write(b.toString('base64'));console.log('\\nIMG4764_B64_END');"`,
      ].join("; "),
    ),
  ].join(" ");

  // Simpler portable command:
  const cmd = `bash -lc 'pwd; ls -la uploads/camera-invoices 2>/dev/null | head -n 20; F=""; for c in ${REL} /opt/render/project/src/${REL} ./backend/${REL}; do if [ -f "$c" ]; then F="$c"; break; fi; done; echo FILE=\$F; if [ -z "\$F" ]; then find /opt/render -name "*IMG_4764*" 2>/dev/null | head -n 20; exit 3; fi; node -e "const fs=require(\\"fs\\");const b=fs.readFileSync(process.argv[1]);const h=require(\\"crypto\\").createHash(\\"sha256\\").update(b).digest(\\"hex\\");console.log(\\"IMG4764_SHA=\\"+h);console.log(\\"IMG4764_LEN=\\"+b.length);console.log(\\"IMG4764_B64_BEGIN\\");process.stdout.write(b.toString(\\"base64\\"));console.log(\\"\\\\nIMG4764_B64_END\\");" "\$F"'`;

  console.log("creating_job…");
  const create = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ startCommand: cmd }),
    signal: AbortSignal.timeout(30_000),
  });
  const createText = await create.text();
  console.log("create", create.status, createText.slice(0, 400));
  if (!create.ok) throw new Error(createText);
  const jobId = (JSON.parse(createText) as { id: string }).id;
  console.log("job", jobId);

  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/jobs/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await st.json()) as { status?: string };
    status = body.status ?? "";
    console.log("poll", i, status);
    if (["succeeded", "failed", "canceled", "cancelled"].includes(status.toLowerCase())) break;
  }

  // Render log stream query
  const ownerId = "tea-d4n5t49gi27c73bntom0";
  const end = new Date();
  const start = new Date(Date.now() - 15 * 60 * 1000);
  const logUrl =
    `https://api.render.com/v1/logs?ownerId=${ownerId}` +
    `&resource=${SERVICE_ID}` +
    `&resource=${jobId}` +
    `&startTime=${encodeURIComponent(start.toISOString())}` +
    `&endTime=${encodeURIComponent(end.toISOString())}` +
    `&limit=100`;
  const logsRes = await fetch(logUrl, { headers, signal: AbortSignal.timeout(60_000) });
  console.log("logs_api", logsRes.status);
  const logsText = await logsRes.text();
  writeFileSync(join(process.cwd(), "_tmp-verify", "job-logs-raw.txt"), logsText);
  console.log("logs_sample", logsText.slice(0, 500));

  if (!logsText.includes("IMG4764_B64_BEGIN") && !logsText.includes("IMG4764_SHA=")) {
    // try service logs filter
    throw new Error(`no payload in logs status=${status}`);
  }

  // Parse possibly JSONL logs
  let combined = logsText;
  try {
    const parsed = JSON.parse(logsText);
    combined = JSON.stringify(parsed);
  } catch {
    /* raw */
  }
  const b64 = combined.split("IMG4764_B64_BEGIN")[1]?.split("IMG4764_B64_END")[0]?.replace(/\s+/g, "") ?? "";
  if (!b64) throw new Error("empty b64");
  const buf = Buffer.from(b64, "base64");
  const sha = createHashSha(buf);
  console.log("bytes", buf.length, "sha", sha);
  if (sha !== EXPECTED_SHA) throw new Error(`sha_mismatch ${sha}`);
  mkdirSync(join(process.cwd(), "_tmp-verify"), { recursive: true });
  writeFileSync(OUT, buf);
  console.log("wrote", OUT);
}

function createHashSha(buf: Buffer) {
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(buf).digest("hex");
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
