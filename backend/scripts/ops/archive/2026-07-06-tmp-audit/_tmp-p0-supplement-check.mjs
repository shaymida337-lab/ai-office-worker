import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const OTHER = "cmqxujfuj034ndy2czu9tjoko";
const apiBase = "https://ai-office-worker-backend.onrender.com";

async function fetchJwtSecret() {
  const res = await fetch(
    `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars?limit=100`,
    { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` } },
  );
  const rows = await res.json();
  return rows.find((r) => (r.envVar ?? r).key === "JWT_SECRET")?.envVar?.value;
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const jwtSecret = await fetchJwtSecret();

const members = await prisma.organizationMember.findMany({
  where: { role: { in: ["read_only", "employee", "accountant"] } },
  include: { user: { select: { id: true, email: true } } },
  take: 10,
});

let debug = { memberCount: members.length, pass: false, statuses: {} };
if (members[0]) {
  const m = members[0];
  const token = jwt.sign(
    { userId: m.userId, organizationId: m.organizationId, email: m.user.email },
    jwtSecret,
    { expiresIn: "1h" },
  );
  for (const path of ["/api/debug/gmail/status", "/api/debug/invoices", "/api/debug/payments/top-amounts"]) {
    const r = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    debug.statuses[path] = r.status;
  }
  debug.role = m.role;
  debug.email = m.user.email;
  debug.pass = Object.values(debug.statuses).every((s) => s === 403);
}

const org = await prisma.organization.findUnique({ where: { id: PILOT }, include: { user: true } });
const ownerToken = jwt.sign(
  { userId: org.user.id, organizationId: PILOT, email: org.user.email },
  jwtSecret,
  { expiresIn: "1h" },
);
const comm = await fetch(`${apiBase}/api/communications?organizationId=${OTHER}&limit=5`, {
  headers: { Authorization: `Bearer ${ownerToken}` },
}).then((r) => r.json());
const events = comm.events ?? comm.items ?? [];
const otherClient = await prisma.client.findFirst({ where: { organizationId: OTHER }, select: { id: true } });
const clientRes = otherClient
  ? await fetch(`${apiBase}/api/clients/${otherClient.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  : null;

const integration = await prisma.integration.findFirst({
  where: { organizationId: PILOT, provider: "gmail" },
  select: { refreshToken: true },
});

// Render log tail via owner API if available
const logUrls = [
  `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/logs?limit=100`,
  `https://api.render.com/v1/logs?ownerId=me&resource=${process.env.RENDER_SERVICE_ID}&limit=50`,
];
const logProbe = [];
for (const url of logUrls) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` } });
  logProbe.push({ url: url.split("?")[0].split("/").slice(-2).join("/"), status: r.status });
}

const sensitivePatterns = [/refresh_token/i, /\bBearer\s+eyJ/, /SECRETS_ENCRYPTION_KEY/];
let logHits = [];
const eventsRes = await fetch(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/deploys?limit=1`, {
  headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` },
});
const deploy = (await eventsRes.json())[0]?.deploy;
if (deploy?.id) {
  const evRes = await fetch(`https://api.render.com/v1/deploys/${deploy.id}/events`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` },
  });
  if (evRes.ok) {
    const evs = await evRes.json();
    const texts = evs.map((e) => JSON.stringify(e.event ?? e)).join("\n");
    for (const p of sensitivePatterns) {
      if (p.test(texts)) logHits.push(p.source);
    }
  }
}

console.log(
  JSON.stringify(
    {
      debugEndpoints: debug,
      tenantIsolation: {
        pass:
          events.filter((e) => e.organizationId && e.organizationId !== PILOT).length === 0 &&
          (clientRes?.status === 403 || clientRes?.status === 404),
        crossOrgEvents: events.filter((e) => e.organizationId && e.organizationId !== PILOT).length,
        crossOrgClientStatus: clientRes?.status ?? null,
        commEventOrgIds: [...new Set(events.map((e) => e.organizationId).filter(Boolean))],
      },
      gmailTokenEncrypted: Boolean(integration?.refreshToken?.startsWith("enc:v1:")),
      logProbe,
      deployEventSensitiveHits: logHits,
      sensitiveLogsPass: logHits.length === 0,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
