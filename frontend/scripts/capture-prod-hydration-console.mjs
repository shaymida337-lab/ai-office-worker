/**
 * Capture React #418 on production with early console hooks (clean context).
 * node scripts/capture-prod-hydration-console.mjs
 */
import { chromium } from "@playwright/test";

const PROD = process.env.PROD_URL ?? "https://ai-office-worker-frontend.onrender.com";

async function run(storage) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript((store) => {
    for (const [k, v] of Object.entries(store || {})) {
      try {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, String(v));
      } catch {}
    }
    window.__logs = [];
    const wrap = (type) => {
      const orig = console[type].bind(console);
      console[type] = (...args) => {
        const text = args
          .map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");
        window.__logs.push({ type, text });
        orig(...args);
      };
    };
    wrap("error");
    wrap("warn");
  }, storage);

  const page = await context.newPage();
  const bridge = [];
  page.on("console", (msg) => {
    bridge.push({ type: msg.type(), text: msg.text() });
  });
  await page.goto(`${PROD}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4000);
  const fromPage = await page.evaluate(() => ({
    logs: (window.__logs || []).filter((l) =>
      /418|hydrat|did not match|server rendered|Text content|Attr/i.test(l.text)
    ),
    attrs: {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      className: document.documentElement.className,
    },
  }));
  const fromBridge = bridge.filter((l) =>
    /418|hydrat|did not match|server rendered|Minified React error/i.test(l.text)
  );
  await browser.close();
  return { storage, fromPage, fromBridge };
}

const cases = [
  { "natalie-theme": null, "natalie-language": null },
  { "natalie-theme": null, "natalie-language": "en" },
  { "natalie-theme": "light", "natalie-language": "en" },
];

const out = [];
for (const c of cases) out.push(await run(c));
console.log(JSON.stringify(out, null, 2));
