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

const apiKey = process.env.RENDER_API_KEY;
const ORG = "cmpjd7j7e0001bl5tzv049rxb";

async function waitDeploy() {
  for (let i = 0; i < 40; i++) {
    const deps = await fetch("https://api.render.com/v1/services/srv-d8992s6gvqtc73boqfp0/deploys?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then((r) => r.json());
    const d = deps[0]?.deploy;
    console.error(new Date().toISOString(), d?.status, d?.commit?.id?.slice(0, 7));
    if (d?.status === "live" && d?.commit?.id?.startsWith("6e50f4c")) return d;
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("deploy timeout");
}

async function renderJwtSecret() {
  let url = "https://api.render.com/v1/services/srv-d898po77f7vs73bu01v0/env-vars?limit=100";
  for (let i = 0; i < 10; i++) {
    const data = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } }).then((r) => r.json());
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/srv-d898po77f7vs73bu01v0/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

const deploy = await waitDeploy();
const secret = await renderJwtSecret();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL.replace("-pooler", "") } } });
const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { user: true } });
const token = jwt.sign({ userId: org.user.id, organizationId: ORG, email: org.user.email }, secret, { expiresIn: "30m" });
await prisma.$disconnect();

process.stdout.write(JSON.stringify({ deploy: deploy.commit?.id?.slice(0, 7), email: org.user.email, token }));
