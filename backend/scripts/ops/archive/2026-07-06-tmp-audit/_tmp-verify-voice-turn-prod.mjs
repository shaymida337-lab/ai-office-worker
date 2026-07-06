import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

config({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  config({ path: join(process.cwd(), ".env.prod.local"), override: true });
}

const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const count = await prisma.natalieConversationSession.count();
  console.log(JSON.stringify({ prismaQueryOk: true, sessionCount: count }));
} catch (err) {
  console.log(JSON.stringify({ prismaQueryOk: false, error: String(err.message || err) }));
} finally {
  await prisma.$disconnect();
}

const base = "https://ai-office-worker-backend.onrender.com";

const noAuth = await fetch(`${base}/api/natalie/voice/turn`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transcript: "שלום" }),
});
console.log(
  JSON.stringify({
    voiceTurnNoAuth: { status: noAuth.status, body: (await noAuth.text()).slice(0, 200) },
  })
);

const email = process.env.PROD_QA_EMAIL ?? process.env.VISUAL_QA_EMAIL;
const password = process.env.PROD_QA_PASSWORD ?? process.env.VISUAL_QA_PASSWORD;
if (email && password) {
  const loginRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (loginRes.ok && loginBody.token) {
    const authed = await fetch(`${base}/api/natalie/voice/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${loginBody.token}`,
      },
      body: JSON.stringify({ transcript: "שלום" }),
    });
    console.log(
      JSON.stringify({
        voiceTurnAuthed: {
          status: authed.status,
          body: (await authed.text()).slice(0, 400),
        },
      })
    );
  } else {
    console.log(JSON.stringify({ voiceTurnAuthed: { skipped: true, loginStatus: loginRes.status } }));
  }
} else {
  console.log(JSON.stringify({ voiceTurnAuthed: { skipped: true, reason: "no PROD_QA_EMAIL/PASSWORD in env" } }));
}
