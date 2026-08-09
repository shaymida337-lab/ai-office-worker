/**
 * Search recent Render logs for invoice-completion timing AND rnet_completion_trace.
 */
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const BACKEND = process.env.RENDER_SERVICE_ID || "srv-d898po77f7vs73bu01v0";
const OWNER = process.env.RENDER_OWNER_ID || "tea-d86903gg4nts73abte2g";
const API = "https://ai-office-worker-backend.onrender.com";
const ORG = "cmqw27e43002bm92bmf9mjy1n";
const USER = "cmqw27e43002am92bl8e6c9a9";
const EMAIL = "kedmashopd1@gmail.com";
const apiKey = process.env.RENDER_API_KEY?.trim();

async function loadJwtSecret() {
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 15; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
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

const secret = await loadJwtSecret();
const token = jwt.sign({ userId: USER, organizationId: ORG, email: EMAIL }, secret, { expiresIn: "10m" });
const since = new Date(Date.now() - 10_000).toISOString();
await fetch(`${API}/api/invoice-completion/list?page=1&pageSize=25&sort=date_desc&_=${Date.now()}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
await new Promise((r) => setTimeout(r, 20000));

const hits = { rnet: [], timing: [], listPath: [] };
let windowEnd = new Date();
for (let page = 0; page < 15; page++) {
  const url =
    `https://api.render.com/v1/logs?ownerId=${OWNER}&resource=${BACKEND}` +
    `&limit=100&direction=backward` +
    `&startTime=${encodeURIComponent(since)}` +
    `&endTime=${encodeURIComponent(windowEnd.toISOString())}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const payload = await res.json();
  const logs = payload.logs ?? [];
  if (!logs.length) break;
  for (const e of logs) {
    const msg = String(e.message ?? "");
    const row = { ts: e.timestamp, msg: msg.slice(0, 300) };
    if (msg.includes("rnet_completion_trace")) hits.rnet.push(row);
    if (/invoice-completion\/list/i.test(msg)) hits.timing.push(row);
    if (/\/api\/invoice-completion\/list/i.test(msg)) hits.listPath.push(row);
  }
  const oldest = logs[logs.length - 1]?.timestamp;
  if (!oldest) break;
  windowEnd = new Date(new Date(oldest).getTime() - 1);
  if (!payload.hasMore && logs.length < 100) break;
}

const out = {
  since,
  rnetCount: hits.rnet.length,
  timingCount: hits.timing.length,
  listPathCount: hits.listPath.length,
  rnet: hits.rnet.slice(0, 20),
  timing: hits.timing.slice(0, 20),
  listPath: hits.listPath.slice(0, 10),
};
writeFileSync(join(process.cwd(), "_tmp-rnet-log-channels.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
