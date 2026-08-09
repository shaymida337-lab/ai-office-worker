import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
const JOB_ID = process.argv[2] || "job-d9bmh27avr4c73b2fn40";

async function main() {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("no key");
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const urls = [
    `https://api.render.com/v1/services/${SERVICE_ID}/jobs/${JOB_ID}`,
    `https://api.render.com/v1/jobs/${JOB_ID}`,
  ];
  for (const url of urls) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    console.log(url, res.status);
    console.log((await res.text()).slice(0, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
