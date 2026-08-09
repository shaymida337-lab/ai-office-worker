import { config as loadEnv } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}
loadEnv({ path: join(process.cwd(), ".env.render-db.tmp"), override: true });

import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const SHAY_ORG = "cmpjd7j7e0001bl5tzv049rxb";
const q = "שרית";

async function fetchRenderJwtSecret() {
  const SERVICE_ID = process.env.RENDER_SERVICE_ID ?? "srv-d898po77f7vs73bu01v0";
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) throw new Error("RENDER_API_KEY missing");
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(
      `https://api.render.com/v1/services/${SERVICE_ID}/env-vars?${qs}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Render API ${res.status}`);
    const data = (await res.json()) as Array<{
      envVar?: { key: string; value: string };
      cursor?: string;
      key?: string;
      value?: string;
    }>;
    for (const item of data) {
      const ev = item.envVar ?? item;
      if (ev?.key === "JWT_SECRET" && ev.value) return ev.value;
    }
    cursor = data.at(-1)?.cursor ?? null;
  } while (cursor);
  throw new Error("JWT_SECRET not found on Render");
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "shaymida337@gmail.com" },
    select: { id: true, email: true, passwordHash: true, organization: { select: { id: true } } },
  });
  if (!user?.organization) throw new Error("user/org missing");

  const clients = await prisma.client.findMany({
    where: { organizationId: SHAY_ORG },
    select: { id: true, name: true, email: true, whatsappNumber: true },
  });
  const leads = await prisma.lead.findMany({
    where: { organizationId: SHAY_ORG },
    select: { id: true, name: true, email: true, phone: true, whatsapp: true, company: true },
  });

  const query = q.trim().toLowerCase();
  const globalClientHits = clients.filter((client) =>
    `${client.name} ${client.email ?? ""} ${client.whatsappNumber ?? ""}`.toLowerCase().includes(query)
  );
  const globalLeadHits = leads.filter((lead) =>
    `${lead.name} ${lead.email ?? ""} ${lead.phone ?? ""} ${lead.whatsapp ?? ""}`.toLowerCase().includes(query)
  );
  const crmHits = leads.filter((lead) =>
    `${lead.name} ${lead.company ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""}`.toLowerCase().includes(query)
  );

  const jwtSecret = await fetchRenderJwtSecret();
  const token = jwt.sign(
    { userId: user.id, organizationId: user.organization.id, email: user.email },
    jwtSecret,
    { expiresIn: "2h" }
  );
  writeFileSync(join(process.cwd(), ".tmp-shay-token.txt"), token, "utf8");

  // Live API parity check against production backend
  const apiBase = "https://ai-office-worker-backend.onrender.com";
  const [clientsRes, leadsRes, leadsSearchRes] = await Promise.all([
    fetch(`${apiBase}/api/clients`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${apiBase}/api/leads`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${apiBase}/api/leads?search=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  const clientsJson = (await clientsRes.json()) as { clients?: Array<{ id: string; name: string }> };
  const leadsJson = (await leadsRes.json()) as { leads?: Array<{ id: string; name: string }> };
  const leadsSearchJson = (await leadsSearchRes.json()) as { leads?: Array<{ id: string; name: string }> };

  const apiClientHits = (clientsJson.clients ?? []).filter((c) => c.name.toLowerCase().includes(query));
  const apiLeadHits = (leadsJson.leads ?? []).filter((l) => l.name.toLowerCase().includes(query));
  const apiLeadSearchHits = (leadsSearchJson.leads ?? []).filter((l) => l.name.toLowerCase().includes(query));

  console.log(
    JSON.stringify(
      {
        userId: user.id,
        orgId: user.organization.id,
        hasPassword: Boolean(user.passwordHash),
        db: {
          clientCount: clients.length,
          leadCount: leads.length,
          globalClientHits: globalClientHits.map((c) => ({ id: c.id, name: c.name })),
          globalLeadHits: globalLeadHits.map((l) => ({ id: l.id, name: l.name })),
          crmHits: crmHits.map((l) => ({ id: l.id, name: l.name })),
        },
        liveApi: {
          clientsStatus: clientsRes.status,
          leadsStatus: leadsRes.status,
          leadsSearchStatus: leadsSearchRes.status,
          apiClientHits: apiClientHits.map((c) => ({ id: c.id, name: c.name })),
          apiLeadHits: apiLeadHits.map((l) => ({ id: l.id, name: l.name })),
          apiLeadSearchHits: apiLeadSearchHits.map((l) => ({ id: l.id, name: l.name })),
        },
        tokenWritten: true,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
