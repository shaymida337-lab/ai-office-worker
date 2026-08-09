/**
 * Capture login form at iPhone 390 width + verify typed text colors.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), ".evidence-login-mobile-text");
mkdirSync(OUT, { recursive: true });

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
await page.goto("http://127.0.0.1:3010/login", { waitUntil: "networkidle" });

// Empty: placeholders visible
await page.locator("#email").evaluate((el) => {
  el.setAttribute("placeholder", "you@example.com");
});
await page.locator("#password").evaluate((el) => {
  el.setAttribute("placeholder", "••••••••");
});
await page.screenshot({ path: join(OUT, "login-empty-390.png"), fullPage: true });

const emptyStyles = await page.evaluate(() => {
  const email = document.querySelector("#email");
  const cs = getComputedStyle(email);
  const ph = getComputedStyle(email, "::placeholder");
  return {
    caretColor: cs.caretColor,
    color: cs.color,
    webkitTextFillColor: cs.webkitTextFillColor,
    backgroundColor: cs.backgroundColor,
    placeholderColor: ph.color,
    placeholderOpacity: ph.opacity,
  };
});

await page.fill("#email", "demo@example.com");
await page.fill("#password", "SecretPass123");
await page.focus("#email");
await page.screenshot({ path: join(OUT, "login-typed-390.png"), fullPage: true });

const styles = await page.evaluate(() => {
  const email = document.querySelector("#email");
  const password = document.querySelector("#password");
  const label = document.querySelector('label[for="email"]');
  const footer = document.querySelector(".auth-form-footer");
  const nav = document.querySelector(".auth-screen-nav a");
  const pick = (el) => {
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
    htmlClass: document.documentElement.className,
    email: pick(email),
    password: pick(password),
    label: pick(label),
    footer: pick(footer),
    nav: pick(nav),
    parentOpacity: getComputedStyle(document.querySelector(".auth-form")).opacity,
    screenOpacity: getComputedStyle(document.querySelector(".auth-screen")).opacity,
  };
});

await page.addStyleTag({
  content: `
    #email, #password {
      box-shadow: 0 0 0 1000px #ffffff inset !important;
      -webkit-text-fill-color: #111827 !important;
      color: #111827 !important;
    }
  `,
});
await page.screenshot({ path: join(OUT, "login-autofill-sim-390.png"), fullPage: true });

console.log(JSON.stringify({ out: OUT, emptyStyles, styles }, null, 2));
await browser.close();
