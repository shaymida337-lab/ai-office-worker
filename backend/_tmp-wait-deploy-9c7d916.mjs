import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const want = (process.argv[2] || "9c7d916").slice(0, 7);
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

async function latest() {
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=5`, { headers });
  const body = await res.json();
  const rows = Array.isArray(body) ? body : [];
  for (const row of rows) {
    const d = row.deploy ?? row;
    const commit = String(d.commit?.id ?? d.commitId ?? "");
    if (commit.startsWith(want)) {
      return {
        id: d.id,
        status: d.status,
        commit: commit.slice(0, 8),
        createdAt: d.createdAt,
        finishedAt: d.finishedAt ?? null,
        message: d.commit?.message?.split("\n")[0] ?? null,
      };
    }
  }
  return null;
}

const terminal = new Set(["live", "update_failed", "build_failed", "canceled", "deactivated"]);
for (let i = 0; i < 40; i++) {
  const hit = await latest();
  console.log(JSON.stringify({ attempt: i, hit }));
  if (hit && terminal.has(hit.status)) {
    process.exit(hit.status === "live" ? 0 : 1);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
process.exit(2);
