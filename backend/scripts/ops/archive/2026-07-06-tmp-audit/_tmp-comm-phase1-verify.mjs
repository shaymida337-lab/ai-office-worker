import { createHmac } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const apiBase = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const databaseUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
const jwtSecretResolved =
  process.env.PROD_JWT_SECRET ?? (await fetchRenderEnvVar("JWT_SECRET")) ?? process.env.JWT_SECRET;
const orgId = process.env.PROD_ORG_ID ?? "cmpjd7j7e0001bl5tzv049rxb";

function twilioSignature(url, params, authToken) {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + params[key];
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function fetchRenderEnvVar(name) {
  const headers = {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    Accept: "application/json",
  };
  const serviceId = process.env.RENDER_SERVICE_ID;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`, { headers });
  const rows = await res.json();
  const row = rows.find((r) => (r.envVar ?? r).key === name);
  const value = (row?.envVar ?? row)?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
  const migrations = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name LIKE '%communication%' ORDER BY finished_at DESC`
  );
  const tableExists = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."CommunicationEvent"') IS NOT NULL AS exists`
  );
  console.log(JSON.stringify({ step: "db_check", migrations, tableExists }, null, 2));

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { user: true, whatsAppAssistant: true },
  });
  if (!org?.user) throw new Error(`org not found: ${orgId}`);

  const authToken = await fetchRenderEnvVar("TWILIO_AUTH_TOKEN");
  const whatsappFrom =
    (await fetchRenderEnvVar("TWILIO_WHATSAPP_NUMBER")) ??
    (await fetchRenderEnvVar("TWILIO_WHATSAPP_FROM")) ??
    "whatsapp:+14155238886";
  const ownerPhone =
    org.whatsAppAssistant?.ownerPhone ??
    (await fetchRenderEnvVar("OWNER_WHATSAPP")) ??
    (await fetchRenderEnvVar("OWNER_WHATSAPP_NUMBER"));
  const jwtSecretResolved =
    process.env.PROD_JWT_SECRET ?? (await fetchRenderEnvVar("JWT_SECRET")) ?? process.env.JWT_SECRET;
  if (!authToken || !ownerPhone) {
    throw new Error(`missing twilio auth or owner phone authToken=${Boolean(authToken)} ownerPhone=${ownerPhone ?? "null"}`);
  }
  if (!jwtSecretResolved) throw new Error("missing JWT secret");

  const messageSid = `MM${Date.now()}phase1`;
  const body = `Communication Core Phase 1 verify ${new Date().toISOString()}`;
  const params = {
    Body: body,
    From: ownerPhone,
    To: whatsappFrom,
    MessageSid: messageSid,
    NumMedia: "0",
  };
  const webhookUrl = "https://ai-office-worker-backend.onrender.com/webhook/whatsapp";
  const signature = twilioSignature(webhookUrl, params, authToken);

  const form = new URLSearchParams(params);
  const postOnce = async () => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body: form.toString(),
    });
    return { status: res.status, text: (await res.text()).slice(0, 200) };
  };

  const first = await postOnce();
  await new Promise((r) => setTimeout(r, 1500));
  const second = await postOnce();

  const events = await prisma.communicationEvent.findMany({
    where: { organizationId: orgId, channel: "whatsapp", externalMessageId: messageSid },
  });
  const allForSid = await prisma.communicationEvent.count({
    where: { organizationId: orgId, channel: "whatsapp", externalMessageId: messageSid },
  });

  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    jwtSecretResolved,
    { expiresIn: "1h" }
  );
  const apiRes = await fetch(`${apiBase}/api/communications?channel=whatsapp&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const apiBody = await apiRes.json();

  console.log(
    JSON.stringify(
      {
        step: "whatsapp_probe",
        messageSid,
        webhookFirst: first,
        webhookSecond: second,
        communicationEventCount: allForSid,
        communicationEvent: events[0] ?? null,
        apiStatus: apiRes.status,
        apiItems: apiBody.items?.slice(0, 3) ?? apiBody,
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
