import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.prod.local") });

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID;
const deployId = process.argv[2] ?? "dep-d94couojs32c73e6spv0";
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; i <= 60; i++) {
  const rows = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=8`, { headers }).then(
    (r) => r.json()
  );
  const deploy = rows.map((r) => r.deploy ?? r).find((d) => d.id === deployId) ?? rows[0]?.deploy ?? rows[0];
  console.log(
    JSON.stringify({
      attempt: i,
      deployId: deploy?.id,
      status: deploy?.status,
      finishedAt: deploy?.finishedAt,
      commitId: deploy?.commit?.id?.slice(0, 8),
    })
  );
  if (deploy?.status === "live") process.exit(0);
  if (["build_failed", "update_failed", "canceled"].includes(deploy?.status ?? "")) process.exit(1);
  await sleep(15_000);
}
process.exit(2);
