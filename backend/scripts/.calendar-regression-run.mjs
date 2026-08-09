import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
loadEnv(join(process.cwd(), ".env.prod.local"));

const ORG_ID = "cmqxujfuj034ndy2czu9tjoko";
const API_BASE = process.env.PROD_API_BASE ?? "https://ai-office-worker-backend.onrender.com";
const MARKER = "רגרסיה-";
const PREFIX = "רגרסיה ";
const TESTS = [];

function fail(command, expected, actual, rootCause) {
  console.log(JSON.stringify({ command, expected, actual, rootCause }, null, 2));
  process.exit(1);
}
function pass(id) {
  TESTS.push(id);
  console.log(`PASS ${id}`);
}
function answer(body) {
  return body?.answer ?? body?.displayResponse ?? body?.spokenResponse ?? "";
}
function clientName(body) {
  return body?.proposal?.clientName ?? body?.proposal?.customerName ?? null;
}

async function fetchRenderJwtSecret() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return null;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const item of data) {
    const e = item.envVar ?? item;
    if (e.key === "JWT_SECRET" && e.value) return e.value;
  }
  return null;
}
async function fetchDeploy() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) return null;
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0]?.deploy ?? data?.[0] ?? null;
}

async function main() {
  const health = await fetch(`${API_BASE}/health`).then((r) => r.json());
  if (!(health.commit ?? "").startsWith("c1cc666")) {
    fail("/health", "commit starts with c1cc666", health.commit, "wrong deployed commit");
  }
  const deploy = await fetchDeploy();
  const jwtSecret = (await fetchRenderJwtSecret()) ?? process.env.PROD_JWT_SECRET ?? process.env.JWT_SECRET;
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.PROD_DATABASE_URL } } });
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID }, include: { user: true } });
  if (!org?.user) fail("org lookup", ORG_ID, null, "org missing");
  const token = jwt.sign(
    { userId: org.user.id, organizationId: org.id, email: org.user.email },
    jwtSecret,
    { expiresIn: "2h" },
  );

  async function ask(question, sessionId, rid) {
    const safeRid = String(rid ?? "reg").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64);
    const res = await fetch(`${API_BASE}/api/natalie/ask`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-request-id": safeRid },
      body: JSON.stringify({ question, sessionId }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await res.json().catch(async () => ({ raw: await res.text() }));
    return { status: res.status, body };
  }
  async function ensureClient(name) {
    let c = await prisma.client.findFirst({ where: { organizationId: ORG_ID, name } });
    if (!c) {
      c = await prisma.client.create({
        data: { organizationId: ORG_ID, name, email: `${MARKER}${randomUUID().slice(0, 8)}@reg.invalid` },
      });
    }
    return c;
  }
  async function pickFreeTime(dayRef, candidates) {
    for (const t of candidates) {
      const r = await ask(`יש מקום ${dayRef} ב-${t}?`, null, `probe-${dayRef}-${t}`);
      if (r.status === 200 && !/תפוס|עמוס|אין מקום|מחוץ לשעות הפעילות/.test(answer(r.body))) return t;
    }
    return null;
  }
  async function pickBookableSlotThroughConfirmation(dayRef, candidates) {
    const probeName = `${PREFIX}זמינות פרוב ${randomUUID().slice(0, 6)}`;
    const probeClient = await ensureClient(probeName);
    for (const t of candidates) {
      const probeSession = randomUUID();
      const propose = await ask(`קבעי תור ל${probeName} ${dayRef} ב-${t}`, probeSession, `probe-book-${t}-a`);
      const proposalSessionId = propose.body?.conversationSessionId ?? probeSession;
      if (propose.status !== 200 || propose.body?.action !== "book_appointment") {
        continue;
      }
      const before = await prisma.appointment.count({
        where: { organizationId: ORG_ID, clientId: probeClient.id, status: { not: "cancelled" } },
      });
      const confirm = await ask("כן", proposalSessionId, `probe-book-${t}-b`);
      const after = await prisma.appointment.count({
        where: { organizationId: ORG_ID, clientId: probeClient.id, status: { not: "cancelled" } },
      });
      if (
        after === before + 1 &&
        confirm.status === 200 &&
        !/תפוס|עמוס|אין מקום|מחוץ לשעות הפעילות/.test(answer(confirm.body))
      ) {
        await prisma.appointment.deleteMany({ where: { organizationId: ORG_ID, clientId: probeClient.id } });
        await prisma.client.delete({ where: { id: probeClient.id } }).catch(() => {});
        return t;
      }
      await prisma.appointment.deleteMany({ where: { organizationId: ORG_ID, clientId: probeClient.id } });
    }
    await prisma.appointment.deleteMany({ where: { organizationId: ORG_ID, clientId: probeClient.id } });
    await prisma.client.delete({ where: { id: probeClient.id } }).catch(() => {});
    return null;
  }

  const yesTime = await pickFreeTime("מחרתיים", ["10:10", "10:40", "11:10", "11:40", "12:10", "12:40", "13:10", "14:10"]);
  const noTime = await pickFreeTime("מחר", ["10:20", "10:50", "11:20", "11:50", "12:20", "12:50", "13:20", "14:20"]);
  const followTime = await pickFreeTime("מחרתיים", ["10:30", "11:30", "12:30", "13:30", "14:30"]);
  if (!yesTime || !noTime || !followTime) fail("availability probes", "free business-hours slots", { yesTime, noTime, followTime }, "no free slots");

  let r = await ask("קבעי תור לדנה מחר ב-10:15", null, "reg-01");
  if (r.status !== 200 || clientName(r.body) !== "דנה") fail("קבעי תור לדנה מחר ב-10:15", "clientName דנה", { status: r.status, clientName: clientName(r.body), answer: answer(r.body) }, "simple parse");
  pass("1");

  r = await ask(`קבעי תור ל${PREFIX}רון כהן מחר ב-10:25`, null, "reg-02");
  if (r.status !== 200 || clientName(r.body) !== `${PREFIX}רון כהן`) fail(`קבעי תור ל${PREFIX}רון כהן מחר ב-10:25`, `${PREFIX}רון כהן`, { clientName: clientName(r.body), answer: answer(r.body) }, "multi-word parse");
  pass("2");

  const yesName = `${PREFIX}אישור כן`;
  const yesClient = await ensureClient(yesName);
  let sid = randomUUID();
  r = await ask(`קבעי תור ל${yesName} מחרתיים ב-${yesTime}`, sid, "reg-03a");
  sid = r.body?.conversationSessionId ?? sid;
  const beforeYes = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: yesClient.id, status: { not: "cancelled" } } });
  const rYes = await ask("כן", sid, "reg-03b");
  const afterYes = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: yesClient.id, status: { not: "cancelled" } } });
  if (afterYes !== beforeYes + 1 || (answer(rYes.body) ?? "").trim().length === 0) fail(`קבעי תור ל${yesName} מחרתיים ב-${yesTime} -> כן`, "count +1 non-empty", { beforeYes, afterYes, status: rYes.status, answer: answer(rYes.body), body: rYes.body }, "confirmation yes");
  pass("3");

  sid = randomUUID();
  r = await ask(`קבעי תור לדנה מחר ב-${noTime}`, sid, "reg-04a");
  sid = r.body?.conversationSessionId ?? sid;
  const dana = await prisma.client.findFirst({ where: { organizationId: ORG_ID, name: "דנה" } });
  const beforeNo = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: dana.id, status: { not: "cancelled" } } });
  await ask("לא", sid, "reg-04b");
  const afterNo = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: dana.id, status: { not: "cancelled" } } });
  if (afterNo !== beforeNo) fail(`קבעי תור לדנה מחר ב-${noTime} -> לא`, "count unchanged", { beforeNo, afterNo }, "confirmation no");
  pass("4");

  sid = randomUUID();
  const r5a = await ask("קבעי תור לדנה", sid, "reg-05a");
  sid = r5a.body?.conversationSessionId ?? sid;
  const r5b = await ask(`מחרתיים ב-${followTime}`, sid, "reg-05b");
  if (!new RegExp(`דנה|${followTime}|לאשר`).test(answer(r5b.body))) fail(`קבעי תור לדנה -> מחרתיים ב-${followTime}`, "follow-up fill", answer(r5b.body), "context");
  pass("5");

  const cohen = await ensureClient(`${PREFIX}רון כהן`);
  const levi = await ensureClient(`${PREFIX}רון לוי`);
  const sharon = await ensureClient(`${PREFIX}שרון`);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
  const t11 = new Date(tomorrow); t11.setHours(11, 0, 0, 0);
  const t14 = new Date(tomorrow); t14.setHours(14, 0, 0, 0);
  await prisma.appointment.createMany({ data: [
    { organizationId: ORG_ID, clientId: cohen.id, startTime: tomorrow, durationMinutes: 30, status: "confirmed", source: "regression", notes: MARKER },
    { organizationId: ORG_ID, clientId: levi.id, startTime: t11, durationMinutes: 30, status: "confirmed", source: "regression", notes: MARKER },
    { organizationId: ORG_ID, clientId: sharon.id, startTime: t14, durationMinutes: 30, status: "confirmed", source: "regression", notes: MARKER },
  ]});
  sid = randomUUID();
  const r6a = await ask(`תבטלי את הפגישה של ${PREFIX}רון`, sid, "reg-06a");
  sid = r6a.body?.conversationSessionId ?? sid;
  const candidates = r6a.body?.calendarSlotFilling?.customerCandidates ?? [];
  if (!(candidates.length >= 2 || /לאיזה|למי|1\.|2\./.test(answer(r6a.body)))) fail(`תבטלי את הפגישה של ${PREFIX}רון`, "ask which customer", { answer: answer(r6a.body), candidates }, "disambiguation");
  const r6b = await ask(`${PREFIX}רון לוי`, sid, "reg-06b");
  if (!new RegExp(`${PREFIX}רון לוי`).test(answer(r6b.body)) || !/לבטל|לאשר/.test(answer(r6b.body))) fail(`${PREFIX}רון לוי`, "resolve levi cancel", { answer: answer(r6b.body) }, "disambiguation resolve");
  pass("6");

  r = await ask("מה יש לי היום ביומן?", null, "reg-07");
  if (!/היום|אין|תור|פגיש/.test(answer(r.body))) fail("מה יש לי היום ביומן?", "valid read", answer(r.body), "read today");
  pass("7");
  r = await ask("מה יש לי מחר ביומן?", null, "reg-08");
  if (!/מחר|אין|תור|פגיש|רגרסיה/.test(answer(r.body))) fail("מה יש לי מחר ביומן?", "valid read", answer(r.body), "read tomorrow");
  pass("8");

  r = await ask(`תבטלי את הפגישה של ${PREFIX}רון כהן מחר`, null, "reg-09");
  if (r.body?.action !== "cancel_appointment") fail(`תבטלי את הפגישה של ${PREFIX}רון כהן מחר`, "cancel_appointment", { action: r.body?.action, answer: answer(r.body) }, "cancel parse");
  pass("9");

  r = await ask(`תעבירי את הפגישה של ${PREFIX}שרון מחר ל-19:00`, null, "reg-10");
  if (r.body?.action !== "reschedule_appointment" || !/19:00/.test(answer(r.body))) fail(`תעבירי את הפגישה של ${PREFIX}שרון מחר ל-19:00`, "reschedule 19:00", { action: r.body?.action, answer: answer(r.body) }, "reschedule parse");
  pass("10");

  r = await ask("קבעי, תור עבור דנה — מחר ב-11:45!", null, "reg-11");
  if (clientName(r.body) !== "דנה") fail("קבעי, תור עבור דנה — מחר ב-11:45!", "customerName דנה", { clientName: clientName(r.body), answer: answer(r.body) }, "punctuation parse");
  pass("11");

  for (const [cmd, day] of [["קבעי תור לדנה היום ב-10:40","היום"],["קבעי תור לדנה מחר ב-10:45","מחר"],["קבעי תור לדנה מחרתיים ב-10:50","מחרתיים"]]) {
    r = await ask(cmd, null, `reg-12-${day}`);
    const dayRef = r.body?.proposal?.dayReference ?? "";
    if (!dayRef.includes(day) && !answer(r.body).includes(day)) fail(cmd, `day ${day}`, { dayRef, answer: answer(r.body) }, "relative date parse");
  }
  pass("12");

  for (const [cmd, expected] of [["קבעי תור לדנה מחר ב-3","15:00"],["קבעי תור לדנה מחר ב-3:30","15:30"],["קבעי תור לדנה מחר ב-15:30","15:30"],["קבעי תור לדנה מחר בשלוש וחצי","15:30"]]) {
    r = await ask(cmd, null, `reg-13-${expected}`);
    const t = r.body?.proposal?.time ?? "";
    if (!(t.startsWith(expected.slice(0, 4)) || answer(r.body).includes(expected))) fail(cmd, `time ${expected}`, { parsedTime: t, answer: answer(r.body) }, "time format parse");
  }
  pass("13");

  r = await ask("קבעי תור לדנה מחר ב-12:00", null, "reg-14");
  if (clientName(r.body) !== "דנה") fail("קבעי תור לדנה מחר ב-12:00", "clientName דנה", { clientName: clientName(r.body), answer: answer(r.body) }, "existing lookup");
  pass("14");

  const newName = `${PREFIX}לקוח חדש ${randomUUID().slice(0, 6)}`;
  r = await ask(`קבעי תור ל${newName} מחר ב-12:15`, null, "reg-15");
  if (clientName(r.body) !== newName || /לא מצאתי לקוח/.test(answer(r.body))) fail(`קבעי תור ל${newName} מחר ב-12:15`, "new customer allowed with full name", { clientName: clientName(r.body), answer: answer(r.body) }, "new customer flow");
  pass("15");

  // 16 duplicate idempotency: pick slot proved available for this specific customer
  const dupName = `${PREFIX}ללא כפילות`;
  const dupClient = await ensureClient(dupName);
  const dupSlot = await pickBookableSlotThroughConfirmation("מחרתיים", ["10:55", "11:55", "12:55", "13:55", "14:55", "15:05"]);
  if (!dupSlot) fail("duplicate-slot-probe", "found available slot for duplicate test", null, "all candidate slots unavailable");
  sid = randomUUID();
  const r16a = await ask(`קבעי תור ל${dupName} מחרתיים ב-${dupSlot}`, sid, "reg-16a");
  sid = r16a.body?.conversationSessionId ?? sid;
  const beforeDup = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: dupClient.id, status: { not: "cancelled" } } });
  const firstYes = await ask("כן", sid, "reg-16b");
  const midDup = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: dupClient.id, status: { not: "cancelled" } } });
  if (midDup !== beforeDup + 1) fail(`קבעי תור ל${dupName} מחרתיים ב-${dupSlot} -> כן`, "first yes creates +1", { beforeDup, midDup, answer: answer(firstYes.body) }, "first booking did not succeed");
  await ask("כן", sid, "reg-16c");
  const afterDup = await prisma.appointment.count({ where: { organizationId: ORG_ID, clientId: dupClient.id, status: { not: "cancelled" } } });
  if (afterDup !== beforeDup + 1) fail(`קבעי תור ל${dupName} מחרתיים ב-${dupSlot} -> כן x2`, "exactly +1", { beforeDup, midDup, afterDup }, "duplicate appointments");
  pass("16");

  const smokeClients = await prisma.client.findMany({ where: { organizationId: ORG_ID, OR: [{ name: { startsWith: PREFIX } }, { email: { contains: MARKER } }] } });
  for (const c of smokeClients) {
    await prisma.appointment.deleteMany({ where: { clientId: c.id } });
    await prisma.client.delete({ where: { id: c.id } }).catch(() => {});
  }
  await prisma.appointment.deleteMany({ where: { organizationId: ORG_ID, OR: [{ source: "regression" }, { notes: MARKER }] } });
  const orphanAppts = await prisma.appointment.count({ where: { organizationId: ORG_ID, OR: [{ source: "regression" }, { notes: MARKER }] } });
  const orphanClients = await prisma.client.count({ where: { organizationId: ORG_ID, OR: [{ name: { startsWith: PREFIX } }, { email: { contains: MARKER } }] } });
  if (orphanAppts !== 0 || orphanClients !== 0) fail("cleanup", "zero smoke records", { orphanAppts, orphanClients }, "cleanup verification");
  pass("17");

  console.log(JSON.stringify({
    commit: "c1cc666",
    deployId: deploy?.id ?? null,
    healthCommit: health.commit,
    tests: 17,
    passed: TESTS.length,
    failed: 0,
    cleanup: { orphanAppts, orphanClients },
    slots: { yesTime, noTime, followTime, dupSlot },
  }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
