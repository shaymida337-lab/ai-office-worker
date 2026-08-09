import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "dotenv";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const scriptDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const backendDir = join(scriptDir, "..");
config({ path: join(backendDir, ".env") });
if (existsSync(join(backendDir, ".env.prod.local"))) {
  config({ path: join(backendDir, ".env.prod.local"), override: true });
}

const FRONT = "https://ai-office-worker-frontend.onrender.com";
const outDir = join(backendDir, "..", "frontend", ".evidence-invoice-ui-v2");
mkdirSync(outDir, { recursive: true });

async function renderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
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

const secret = await renderJwtSecret();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL.replace("-pooler", "") } } });
const org = await prisma.organization.findUnique({ where: { id: "cmpjd7j7e0001bl5tzv049rxb" }, include: { user: true } });
const token = jwt.sign({ userId: org.user.id, organizationId: "cmpjd7j7e0001bl5tzv049rxb", email: org.user.email }, secret, { expiresIn: "30m" });
await prisma.$disconnect();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "he-IL" });
const page = await context.newPage();

await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
await page.evaluate((value) => localStorage.setItem("token", value), token);

await page.goto(`${FRONT}/dashboard/invoices?v=6e50f4c`, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
const invoicesPath = join(outDir, "invoices-after-1440.png");
await page.screenshot({ path: invoicesPath, fullPage: true });
const invoicesMarkers = await page.evaluate(() => ({
  title: document.body.innerText.includes("חשבוניות"),
  hasBusinessTable: !!document.querySelector(".invoices-business-table"),
  hasSupplierColumn: document.body.innerText.includes("סוג מסמך"),
  noDescriptionColumn: !document.body.innerText.includes("תיאור"),
}));

await page.goto(`${FRONT}/reports?v=6e50f4c`, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
const reportsPath = join(outDir, "reports-after-1440.png");
await page.screenshot({ path: reportsPath, fullPage: true });
const reportsMarkers = await page.evaluate(() => ({
  hasCompletionCards: !!document.querySelector(".invoice-completion-card"),
  cardCount: document.querySelectorAll(".invoice-completion-card").length,
}));

console.log(
  JSON.stringify(
    {
      email: org.user.email,
      screenshots: { invoices: invoicesPath, reports: reportsPath },
      invoicesMarkers,
      reportsMarkers,
    },
    null,
    2,
  ),
);

await browser.close();

