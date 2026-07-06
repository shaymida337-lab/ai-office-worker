import { config } from "dotenv";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

config({ path: join(process.cwd(), ".env.prod.local") });

const PILOT = "cmpjd7j7e0001bl5tzv049rxb";
const apiBase = "https://ai-office-worker-backend.onrender.com";
const email = `domain1-morning-only-${Date.now()}@temp-verify.invalid`;

async function jwtSecret() {
  const rows = await fetch(
    `https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}/env-vars?limit=100`,
    { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` } },
  ).then((r) => r.json());
  return rows.find((r) => (r.envVar ?? r).key === "JWT_SECRET")?.envVar?.value;
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
const secret = await jwtSecret();
const user = await prisma.user.create({ data: { email, name: "temp", passwordHash: null } });
const member = await prisma.organizationMember.create({
  data: { organizationId: PILOT, userId: user.id, role: "read_only" },
});
const token = jwt.sign({ userId: user.id, organizationId: PILOT, email }, secret, { expiresIn: "1h" });

const checks = [
  ["GET", "/api/whatsapp/test"],
  ["POST", "/api/whatsapp/test"],
  ["GET", "/api/integrations/whatsapp/test"],
  ["POST", "/api/integrations/whatsapp/test"],
  ["POST", "/api/whatsapp-assistant/test/morning"],
  ["PUT", "/api/integrations/whatsapp/settings"],
];

const results = [];
for (const [method, path] of checks) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: method === "PUT" ? JSON.stringify({ ownerPhone: "whatsapp:+10000000000" }) : undefined,
  });
  results.push({ method, path, status: res.status, body: (await res.text()).slice(0, 120) });
}

await prisma.organizationMember.delete({ where: { id: member.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();

console.log(JSON.stringify({ health: await fetch(`${apiBase}/health`).then((r) => r.json()), results }, null, 2));
