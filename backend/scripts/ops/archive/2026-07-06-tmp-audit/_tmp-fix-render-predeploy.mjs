import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.prod.local") });

const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID;
// Neon pooler cannot hold Prisma migrate advisory locks; use direct host when DIRECT_URL unset.
const PRE_DEPLOY =
  'export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL//-pooler/}}" && cd backend && DATABASE_URL="$DIRECT_URL" PRISMA_MIGRATE_ADVISORY_LOCK_TIMEOUT=60000 npx prisma migrate deploy';

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

function pick(svc) {
  const d = svc.serviceDetails?.envSpecificDetails ?? {};
  return {
    buildCommand: d.buildCommand,
    startCommand: d.startCommand,
    preDeployCommand: d.preDeployCommand ?? null,
  };
}

const beforeSvc = await fetch(`https://api.render.com/v1/services/${serviceId}`, { headers }).then((r) =>
  r.json()
);
console.log(JSON.stringify({ step: "before", config: pick(beforeSvc) }, null, 2));

const patched = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ serviceDetails: { preDeployCommand: PRE_DEPLOY } }),
}).then((r) => r.json());

console.log(JSON.stringify({ step: "after", config: pick(patched) }, null, 2));

const deploy = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
  method: "POST",
  headers,
  body: JSON.stringify({ clearCache: "do_not_clear" }),
}).then((r) => r.json());

const d = deploy.deploy ?? deploy;
console.log(JSON.stringify({ step: "deployTriggered", id: d.id, status: d.status, createdAt: d.createdAt }, null, 2));
