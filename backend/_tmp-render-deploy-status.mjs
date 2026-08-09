import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
if (!apiKey) {
  console.log(JSON.stringify({ error: "RENDER_API_KEY missing" }));
  process.exit(2);
}

const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

async function getJson(url) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return { status: res.status, body };
}

const deploysUrl = `https://api.render.com/v1/services/${serviceId}/deploys?limit=8`;
const deploys = await getJson(deploysUrl);
console.log(JSON.stringify({ deploysUrl, status: deploys.status, preview: Array.isArray(deploys.body) ? deploys.body.slice(0, 2) : deploys.body }, null, 2));

if (!Array.isArray(deploys.body)) process.exit(1);

const summary = [];
for (const row of deploys.body.slice(0, 8)) {
  const deploy = row.deploy ?? row;
  const events = await getJson(`https://api.render.com/v1/services/${serviceId}/deploys/${deploy.id}/events`);
  const eventList = Array.isArray(events.body) ? events.body.map((e) => e.event ?? e) : [];
  const texts = eventList.map((e) => String(e.details ?? e.message ?? e.text ?? "").slice(0, 400));
  const failureTexts = texts.filter((t) => /error|fail|prisma|migration|crash|exit|OOM|timeout|invalid/i.test(t));
  summary.push({
    id: deploy.id,
    status: deploy.status,
    createdAt: deploy.createdAt,
    finishedAt: deploy.finishedAt,
    commit: deploy.commit?.id?.slice(0, 8) ?? deploy.commitId?.slice?.(0, 8) ?? null,
    commitMessage: deploy.commit?.message?.slice?.(0, 120) ?? null,
    failureTexts: failureTexts.slice(0, 12),
    lastEvents: texts.slice(-6),
  });
}

console.log(JSON.stringify({ serviceId, summary }, null, 2));
