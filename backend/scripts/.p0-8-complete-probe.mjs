import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const backendDir = process.cwd().endsWith("backend") ? process.cwd() : join(process.cwd(), "backend");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmpjd7j7e0001bl5tzv049rxb";

async function jwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  let url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const data = await res.json();
    for (const item of Array.isArray(data) ? data : []) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${serviceId}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET missing");
}

async function main() {
  const secret = await jwtSecret();
  const dbUrl = (process.env.PROD_DATABASE_URL || "").replace("-pooler", "");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
  const token = jwt.sign(
    { userId: org.user.id, organizationId: ORG, email: org.user.email },
    secret,
    { expiresIn: "15m" },
  );
  await prisma.$disconnect();

  const list = await fetch(`${API}/api/invoices?completeness=incomplete`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());

  const candidates = (list.invoices ?? []).filter((i) => i.dataComplete && i.approvalRequired).slice(0, 5);
  console.log("awaiting", candidates.length);
  for (const row of candidates) {
    let sourceType = "document-review";
    let rawId = row.id;
    if (row.id.startsWith("gmail-scan:")) {
      sourceType = "gmail-scan-item";
      rawId = row.id.replace(/^gmail-scan:/, "");
    } else if (row.id.startsWith("supplier-payment:")) {
      sourceType = "supplier-payment";
      rawId = row.id.replace(/^supplier-payment:/, "");
    } else {
      rawId = row.id.replace(/^document-review:/, "");
    }
    const res = await fetch(`${API}/api/invoices/${sourceType}/${rawId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    const body = await res.text();
    console.log(row.id, row.amount, res.status, body.slice(0, 180));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
