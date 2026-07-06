import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID;
if (!apiKey || !serviceId) {
  console.log(JSON.stringify({ error: "RENDER_API_KEY or RENDER_SERVICE_ID missing" }));
  process.exit(2);
}

const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
const deploysRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=5`, { headers });
const deploysPayload = await deploysRes.json();
if (!deploysRes.ok) {
  console.log(JSON.stringify({ error: "deploys fetch failed", status: deploysRes.status, body: deploysPayload }));
  process.exit(1);
}

const deploys = Array.isArray(deploysPayload)
  ? deploysPayload.map((row) => row.deploy ?? row)
  : deploysPayload;

const summary = [];
for (const deploy of deploys.slice(0, 5)) {
  const id = deploy.id;
  const eventsRes = await fetch(`https://api.render.com/v1/deploys/${id}/events`, { headers });
  const eventsPayload = await eventsRes.json();
  const events = Array.isArray(eventsPayload)
    ? eventsPayload.map((row) => row.event ?? row)
    : [];
  const migrateEvents = events
    .filter((e) => /migrate|prisma|preDeploy|pre-deploy|migration/i.test(JSON.stringify(e)))
    .map((e) => ({
      timestamp: e.timestamp ?? e.createdAt ?? null,
      text: e.details ?? e.message ?? e.text ?? JSON.stringify(e).slice(0, 300),
    }));
  summary.push({
    id,
    status: deploy.status,
    createdAt: deploy.createdAt,
    finishedAt: deploy.finishedAt,
    commitId: deploy.commit?.id ?? deploy.commitId ?? null,
    migrateRelatedEvents: migrateEvents.slice(0, 8),
    lastEvent:
      events.length > 0
        ? (events[events.length - 1].details ?? events[events.length - 1].message ?? "").slice(0, 200)
        : null,
  });
}

console.log(JSON.stringify({ serviceId, recentDeploys: summary }, null, 2));
