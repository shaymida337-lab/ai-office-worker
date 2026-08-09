import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const res = await page.goto("https://ai-office-worker.com/login", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
console.log("status", res?.status(), "url", page.url());
await page.waitForTimeout(4000);
const html = await page.content();
console.log("title", await page.title());
console.log("has auth-form", html.includes("auth-form"));
console.log("has auth-screen", html.includes("auth-screen"));
console.log("has id=email", html.includes('id="email"'));
console.log("input count", await page.locator("input").count());
const inputs = await page.locator("input").evaluateAll((els) =>
  els.map((el) => ({ id: el.id, name: el.name, type: el.type, className: el.className }))
);
console.log("inputs", JSON.stringify(inputs, null, 2));
const bodyIdx = html.indexOf("<body");
console.log(html.slice(bodyIdx, bodyIdx + 3000));
await browser.close();
