/**
 * READ-ONLY: locate Rnet across completion + invoices APIs.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const API = "https://ai-office-worker-backend.onrender.com";
const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const RNET = "cmqw3n5hx020dm92bp1joi8wu";

async function loadJwtSecret() {
  const renderKey = process.env.RENDER_API_KEY?.trim();
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && typeof val === "string") return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor || data.length < 100) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  return process.env.JWT_SECRET;
}

function findRnet(arr: any[]) {
  return arr.filter(
    (r) =>
      String(r.id || "").includes(RNET) ||
      String(r.reviewSourceId || "") === RNET ||
      Number(r.amount) === 354 ||
      /ערנט|OV255|rnet/i.test(`${r.supplierName || ""} ${r.invoiceNumber || ""}`) ||
      String(r.gmailMessageId || "") === "19ee12f8ab9f4579" ||
      String(r.gmailMessageId || "") === "19f9e3d9101ed94d",
  );
}

async function main() {
  const u = new URL(process.env.PROD_DATABASE_URL!);
  u.searchParams.set("pgbouncer", "true");
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  try {
    const fdr = await prisma.financialDocumentReview.findUnique({
      where: { id: RNET },
      select: {
        id: true,
        supplierPaymentId: true,
        supplierName: true,
        totalAmount: true,
        reviewStatus: true,
        uncertaintyReason: true,
        gmailMessageId: true,
        documentDate: true,
        currency: true,
        documentType: true,
      },
    });
    const secret = await loadJwtSecret();
    const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret!, { expiresIn: "15m" });
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-cache",
    };
    const completion = await (await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const invoicesAll = await (await fetch(`${API}/api/invoices/list?page=1&pageSize=100&sort=date_desc`, { headers })).json();
    const invoicesComplete = await (
      await fetch(`${API}/api/invoices/list?completeness=complete&page=1&pageSize=100&sort=date_desc`, { headers })
    ).json();
    const invoicesIncomplete = await (
      await fetch(`${API}/api/invoices/list?completeness=incomplete&page=1&pageSize=100&sort=date_desc`, { headers })
    ).json();

    const rows = completion.rows || [];
    const out = {
      fdr,
      completion: { total: completion.total, hits: findRnet(rows) },
      invoicesAll: { total: invoicesAll.total, hits: findRnet(invoicesAll.invoices || invoicesAll.rows || []) },
      invoicesComplete: {
        total: invoicesComplete.total,
        hits: findRnet(invoicesComplete.invoices || invoicesComplete.rows || []),
      },
      invoicesIncomplete: {
        total: invoicesIncomplete.total,
        hits: findRnet(invoicesIncomplete.invoices || invoicesIncomplete.rows || []),
      },
      completionAmounts: rows.map((r: any) => ({ id: r.id, amount: r.amount, source: r.source })).filter((r: any) => r.amount != null),
    };
    writeFileSync(join(process.cwd(), "_tmp-rnet-api-locate.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
