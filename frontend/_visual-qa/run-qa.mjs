import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "screenshots");
const BASE = "http://localhost:3000";

const PAGES = [
  { id: "01-home", path: "/" },
  { id: "02-login", path: "/login" },
  { id: "03-signup", path: "/signup" },
  { id: "04-onboarding", path: "/onboarding" },
  { id: "05-dashboard", path: "/dashboard" },
  { id: "06-billing-plans", path: "/billing/plans" },
  { id: "07-invoices", path: "/invoices" },
  { id: "08-payments", path: "/payments" },
  { id: "09-tasks", path: "/tasks" },
  { id: "10-settings", path: "/settings" },
];

const VIEWPORTS = [
  { id: "390", width: 390, height: 844 },
  { id: "430", width: 430, height: 932 },
  { id: "768", width: 768, height: 1024 },
  { id: "desktop", width: 1440, height: 900 },
];

fs.mkdirSync(OUT, { recursive: true });

const report = [];

function push(row) {
  report.push(row);
  console.log(JSON.stringify(row));
}

async function analyzePage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const horizontalOverflow =
      Math.max(doc.scrollWidth, body.scrollWidth) > Math.min(window.innerWidth, doc.clientWidth) + 1;

    const clipped = [];
    const candidates = document.querySelectorAll("h1,h2,h3,p,span,button,a,label,td,th,li");
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (el.scrollWidth > el.clientWidth + 2 && (style.overflow === "hidden" || style.textOverflow === "ellipsis" || el.classList.contains("truncate") || el.classList.contains("line-clamp-2") || el.classList.contains("line-clamp-3") || el.classList.contains("line-clamp-4"))) {
        const text = (el.textContent || "").trim().slice(0, 80);
        if (text) clipped.push({ tag: el.tagName.toLowerCase(), text, w: Math.round(rect.width) });
      }
      if (rect.right > window.innerWidth + 2 || rect.left < -2) {
        clipped.push({ tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 60), issue: "off-screen", right: Math.round(rect.right), vw: window.innerWidth });
      }
    }

    const buttons = [...document.querySelectorAll("button,.btn,a.btn")].slice(0, 12).map((el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        text: (el.textContent || "").trim().slice(0, 40),
        h: Math.round(r.height),
        fs: style.fontSize,
        visible: r.width > 0 && r.height > 0,
      };
    });

    const bottomNav = document.querySelector("nav.fixed.bottom-0");
    let navInfo = null;
    if (bottomNav) {
      const r = bottomNav.getBoundingClientRect();
      navInfo = {
        height: Math.round(r.height),
        labels: [...bottomNav.querySelectorAll("span")].map((s) => (s.textContent || "").trim()).filter(Boolean),
        overlapsContent: r.top < window.innerHeight - 2,
      };
    }

    return {
      title: document.title,
      url: location.pathname,
      horizontalOverflow,
      clipped: clipped.slice(0, 8),
      buttons,
      navInfo,
      scrollW: Math.max(doc.scrollWidth, body.scrollWidth),
      clientW: window.innerWidth,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "he-IL" });

for (const vp of VIEWPORTS) {
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });

  for (const p of PAGES) {
    const url = `${BASE}${p.path}`;
    let status = "ok";
    let note = "";
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(800);
      const finalUrl = page.url();
      if (resp && resp.status() >= 400) {
        status = "http-error";
        note = `HTTP ${resp.status()}`;
      }
      if (finalUrl !== url && !finalUrl.endsWith(p.path)) {
        note = note ? `${note}; redirected to ${new URL(finalUrl).pathname}` : `redirected to ${new URL(finalUrl).pathname}`;
      }

      const analysis = await analyzePage(page);
      const shot = path.join(OUT, `${p.id}__${vp.id}.png`);
      await page.screenshot({ path: shot, fullPage: true });

      const hugeButtons = analysis.buttons.filter((b) => b.visible && b.h > 72);
      const tinyButtons = analysis.buttons.filter((b) => b.visible && b.h > 0 && b.h < 44);

      push({
        page: p.path,
        viewport: vp.id,
        status,
        note,
        finalPath: analysis.url,
        horizontalOverflow: analysis.horizontalOverflow,
        scrollW: analysis.scrollW,
        clientW: analysis.clientW,
        clippedCount: analysis.clipped.length,
        clipped: analysis.clipped,
        hugeButtons,
        tinyButtons,
        navInfo: analysis.navInfo,
        screenshot: path.relative(path.join(__dirname, ".."), shot).replace(/\\/g, "/"),
      });
    } catch (err) {
      push({
        page: p.path,
        viewport: vp.id,
        status: "error",
        note: String(err.message || err),
      });
    }
  }
  await page.close();
}

await browser.close();

fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(report, null, 2));
console.log(`\nWrote ${report.length} rows to ${path.join(__dirname, "report.json")}`);
