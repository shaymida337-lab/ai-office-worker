/**
 * Measure Home→CRM with abort tracking (local FE + prod API).
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
import jwt from "jsonwebtoken";
import { createRequire } from "module";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), ".env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), ".env.prod.local"), override: false });
}

const apiKey = process.env.RENDER_API_KEY?.trim();
if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const BACKEND = "srv-d898po77f7vs73bu01v0";
const SITE = process.env.MEASURE_SITE ?? "http://localhost:3012";
const API = "https://ai-office-worker-backend.onrender.com";
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

async function renderJwtSecret() {
  let url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100`;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`env-vars ${res.status}`);
    const data = await res.json();
    for (const item of data) {
      const key = item.envVar?.key ?? item.key;
      const val = item.envVar?.value ?? item.value;
      if (key === "JWT_SECRET" && val) return val;
    }
    const cursor = data.at(-1)?.cursor;
    if (!cursor) break;
    url = `https://api.render.com/v1/services/${BACKEND}/env-vars?limit=100&cursor=${cursor}`;
  }
  throw new Error("JWT_SECRET not found");
}

const secret = await renderJwtSecret();
const token = jwt.sign(
  {
    userId: "cmpjd7j7e0000bl5tu149spmk",
    organizationId: "cmpjd7j7e0001bl5tzv049rxb",
    email: "shaymida337@gmail.com",
  },
  secret,
  { expiresIn: "30m" }
);

const require = createRequire(join(process.cwd(), "../frontend/package.json"));
const { chromium, devices } = require("playwright");
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
});
const context = await browser.newContext({ ...devices["iPhone 13"], locale: "he-IL", bypassCSP: true });
const page = await context.newPage();

const events = [];
const pending = new Map();

function shortPath(url) {
  return url.replace(API, "").split("?")[0];
}

page.on("request", (req) => {
  const url = req.url();
  if (!url.includes("/api/stats") && !url.includes("/api/document-reviews") && !(url.includes("/api/leads") && !url.includes("/templates") && !/\/api\/leads\/[^/?]+/.test(url))) {
    return;
  }
  pending.set(req, Date.now());
  events.push({ type: "start", path: shortPath(url), t: Date.now() });
});
page.on("requestfailed", (req) => {
  const started = pending.get(req);
  pending.delete(req);
  if (started == null) return;
  events.push({
    type: "failed",
    path: shortPath(req.url()),
    ms: Date.now() - started,
    error: req.failure()?.errorText ?? null,
    t: Date.now(),
  });
});
page.on("response", (res) => {
  const req = res.request();
  const started = pending.get(req);
  if (started == null) return;
  pending.delete(req);
  events.push({
    type: "done",
    path: shortPath(res.url()),
    ms: Date.now() - started,
    status: res.status(),
    t: Date.now(),
  });
});

await page.goto(`${SITE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.evaluate((t) => {
  localStorage.setItem("token", t);
  localStorage.setItem("authToken", t);
  localStorage.setItem("accessToken", t);
}, token);
await page.goto(`${SITE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(
  () => /העסק שלי|דבר עם נטלי|ברוך|שלום/.test(document.body?.innerText ?? ""),
  { timeout: 120000 }
);
await page.waitForTimeout(600);

const navStart = Date.now();
await Promise.all([
  page.waitForURL(/\/crm/, { timeout: 60000 }),
  page.evaluate(() => {
    const link = document.querySelector('a[href="/crm"]');
    if (!link) throw new Error("crm link missing");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }),
]);
await page.waitForFunction(
  () => /ניהול לקוחות/.test(document.body?.innerText ?? ""),
  { timeout: 90000 }
);
const screenAppearMs = Date.now() - navStart;

await page.waitForResponse(
  (r) => {
    const u = r.url();
    return u.includes("/api/leads") && !u.includes("/templates") && !/\/api\/leads\/[^/?]+/.test(u) && r.ok();
  },
  { timeout: 120000 }
);
const dataLoadedMs = Date.now() - navStart;
await page.waitForTimeout(2500);

const statsDocs = events.filter((e) => e.path.includes("/api/stats") || e.path.includes("/api/document-reviews"));
const leads = events.filter((e) => e.path === "/api/leads");
const aborted = statsDocs.filter((e) => e.type === "failed");
const completedAfterNav = statsDocs.filter((e) => e.type === "done" && e.t >= navStart);

console.log(
  JSON.stringify(
    {
      site: SITE,
      beforeBaseline: { dataLoadedMs: 9031, stillPending: ["/api/stats", "/api/document-reviews"] },
      screenAppearMs,
      dataLoadedMs,
      under3s: dataLoadedMs < 3000,
      abortedHeavy: aborted,
      completedHeavyAfterNav: completedAfterNav,
      leads,
      stillPending: [...pending.keys()].map((r) => shortPath(r.url())),
    },
    null,
    2
  )
);

await browser.close();
process.exit(dataLoadedMs < 3000 ? 0 : 2);
