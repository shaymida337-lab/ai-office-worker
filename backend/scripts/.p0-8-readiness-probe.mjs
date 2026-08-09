import { config } from "dotenv";
import { join } from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env.prod.local"), override: true });

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

  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log("health", health.commit?.slice(0, 7));

  const list = await fetch(`${API}/api/invoices?completeness=incomplete`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }).then((r) => r.json());

  const sample = (list.invoices ?? []).filter((i) => i.dataComplete && i.approvalRequired).slice(0, 8);
  for (const row of sample) {
    console.log(
      JSON.stringify({
        id: row.id,
        amount: row.amount,
        canApproveDirectly: row.canApproveDirectly,
        supplierNeedsConfirmation: row.supplierNeedsConfirmation,
        approvalBlockReason: row.approvalBlockReason,
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
