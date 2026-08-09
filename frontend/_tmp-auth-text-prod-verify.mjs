/**
 * Wait for frontend deploy a708a26, then verify login/signup text colors at 390px on prod.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env") });
if (existsSync(join(process.cwd(), "../backend/.env"))) {
  loadEnv({ path: join(process.cwd(), "../backend/.env"), override: false });
}
if (existsSync(join(process.cwd(), "../backend/.env.prod.local"))) {
  loadEnv({ path: join(process.cwd(), "../backend/.env.prod.local"), override: false });
}

const WANT = "a708a268aeeebc0989993c7d4fc2de1c999b24ef";
const FRONTEND = process.env.RENDER_FRONTEND_SERVICE_ID || "srv-d8992s6gvqtc73boqfp0";
const SITE =
  process.env.NEXT_PUBLIC_SITE_URL || "https://ai-office-worker-frontend.onrender.com";
const apiKey = process.env.RENDER_API_KEY?.trim();
const OUT = join(process.cwd(), ".evidence-login-mobile-text-prod");
mkdirSync(OUT, { recursive: true });

async function latestDeploy() {
  const res = await fetch(`https://api.render.com/v1/services/${FRONTEND}/deploys?limit=1`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const data = await res.json();
  return data?.[0]?.deploy ?? data?.[0] ?? null;
}

async function waitLive(maxMs = 25 * 60 * 1000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < maxMs) {
    const d = await latestDeploy().catch(() => null);
    const status = d?.status ?? "?";
    const commit = d?.commit?.id ?? "";
    const line = `frontend=${status} commit=${commit.slice(0, 8)}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (status === "live" && commit.startsWith(WANT.slice(0, 7))) return d;
    if (status === "live" && commit === WANT) return d;
    if (["build_failed", "update_failed", "canceled"].includes(status)) {
      throw new Error(`deploy failed: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("timeout waiting for frontend deploy");
}

function pick(elStyles) {
  return {
    color: elStyles.color,
    caretColor: elStyles.caretColor,
    backgroundColor: elStyles.backgroundColor,
    opacity: elStyles.opacity,
    webkitTextFillColor: elStyles.webkitTextFillColor,
  };
}

async function checkPage(page, path, shotName) {
  await page.goto(`${SITE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  // bust cache a bit
  await page.reload({ waitUntil: "networkidle" });

  const hasAuthForm = await page.locator(".auth-form").count();
  await page.locator("#email").evaluate((el) => el.setAttribute("placeholder", "you@example.com"));
  if (await page.locator("#password").count()) {
    await page.locator("#password").evaluate((el) => el.setAttribute("placeholder", "••••••••"));
  }

  const empty = await page.evaluate(() => {
    const email = document.querySelector("#email");
    const cs = getComputedStyle(email);
    const ph = getComputedStyle(email, "::placeholder");
    return {
      color: cs.color,
      caretColor: cs.caretColor,
      fill: cs.webkitTextFillColor,
      bg: cs.backgroundColor,
      placeholderColor: ph.color,
      placeholderOpacity: ph.opacity,
      htmlClass: document.documentElement.className,
      hasAuthForm: Boolean(document.querySelector(".auth-form")),
      hasAuthScreen: Boolean(document.querySelector(".auth-screen")),
    };
  });

  await page.fill("#email", "demo@example.com");
  await page.fill("#password", "SecretPass123");
  await page.focus("#email");
  await page.screenshot({ path: join(OUT, shotName), fullPage: true });

  const typed = await page.evaluate(() => {
    const email = document.querySelector("#email");
    const password = document.querySelector("#password");
    const label = document.querySelector('label[for="email"]');
    const footer = document.querySelector(".auth-form-footer");
    const nav = document.querySelector(".auth-screen-nav a");
    const pickEl = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        caretColor: cs.caretColor,
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
        webkitTextFillColor: cs.webkitTextFillColor,
      };
    };
    return {
      email: pickEl(email),
      password: pickEl(password),
      label: pickEl(label),
      footer: pickEl(footer),
      nav: pickEl(nav),
      parentOpacity: document.querySelector(".auth-form")
        ? getComputedStyle(document.querySelector(".auth-form")).opacity
        : null,
    };
  });

  // Autofill simulation visual
  await page.addStyleTag({
    content: `#email,#password{box-shadow:0 0 0 1000px #fff inset!important;-webkit-text-fill-color:#111827!important;color:#111827!important;caret-color:#111827!important;}`,
  });
  await page.screenshot({ path: join(OUT, shotName.replace(".png", "-autofill-sim.png")), fullPage: true });

  const ok =
    hasAuthForm > 0 &&
    typed.email?.color === "rgb(17, 24, 39)" &&
    typed.email?.webkitTextFillColor === "rgb(17, 24, 39)" &&
    typed.email?.backgroundColor === "rgb(255, 255, 255)" &&
    empty.placeholderColor === "rgb(107, 114, 128)" &&
    typed.label?.color === "rgb(17, 24, 39)" &&
    typed.nav?.color === "rgb(29, 91, 255)" &&
    typed.parentOpacity === "1";

  return { path, hasAuthForm, empty, typed, ok };
}

if (!apiKey) {
  console.error("RENDER_API_KEY missing");
  process.exit(1);
}

const deploy = await waitLive();
console.log(JSON.stringify({ deployStatus: deploy.status, commit: deploy.commit?.id }, null, 2));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

const login = await checkPage(page, "/login", "prod-login-typed-390.png");
const signup = await checkPage(page, "/signup", "prod-signup-typed-390.png");

// Spot-check a non-auth input page isn't forced by auth selectors (settings needs auth; use landing form if present)
await page.goto(`${SITE}/contact`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
const unrelatedAuthLeak = await page.evaluate(() => ({
  authFormCount: document.querySelectorAll(".auth-form").length,
  authScreenCount: document.querySelectorAll(".auth-screen").length,
}));

await browser.close();

const out = {
  want: WANT,
  deploy: { status: deploy.status, commit: deploy.commit?.id },
  login,
  signup,
  unrelatedAuthLeak,
  allOk: login.ok && signup.ok && unrelatedAuthLeak.authFormCount === 0,
};
writeFileSync(join(OUT, "prod-verify.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
