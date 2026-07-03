import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  openAuthenticatedDashboard,
  prepareAuthenticatedDashboard,
} from "./dashboard-auth.mjs";
import {
  DASHBOARD_VISUAL_QA_BASE,
  assertDashboardServerReady,
} from "./dashboard-qa-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "phase7-compare");
const BASE = process.env.VISUAL_QA_BASE ?? DASHBOARD_VISUAL_QA_BASE;
const API_URL = process.env.VISUAL_QA_API ?? "http://localhost:4000";

const VIEWPORTS = [
  { id: "390", width: 390, height: 844, kpiCols: 2, quickCols: 2 },
  { id: "430", width: 430, height: 932, kpiCols: 2, quickCols: 3 },
  { id: "768", width: 768, height: 1024, kpiCols: 2, quickCols: 3 },
  { id: "1024", width: 1024, height: 900, kpiCols: 4, quickCols: 3 },
  { id: "1366", width: 1366, height: 900, kpiCols: 4, quickCols: 3 },
  { id: "1600", width: 1600, height: 900, kpiCols: 4, quickCols: 3 },
  { id: "1920", width: 1920, height: 1080, kpiCols: 4, quickCols: 3 },
];

fs.mkdirSync(OUT, { recursive: true });

function expectedActivityVisible(width) {
  return width >= 768;
}

async function analyze(page, viewport) {
  return page.evaluate((vp) => {
    const doc = document.documentElement;
    const body = document.body;
    const vw = window.innerWidth;
    const scrollW = Math.max(doc.scrollWidth, body.scrollWidth);
    const horizontalOverflow = scrollW > vw + 1;

    const root = document.querySelector(".dashboard-home-stack") ?? document.querySelector("main.dashboard-shell");
    if (!root) {
      return { horizontalOverflow: true, authenticated: false, error: "dashboard root missing" };
    }

    const offScreen = [];
    for (const el of root.querySelectorAll("button,a,[data-testid^='dashboard-'],#natalie-decisions *")) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (rect.right > vw + 2 || rect.left < -2) {
        offScreen.push({ tag: el.tagName.toLowerCase(), testid: el.getAttribute("data-testid"), right: Math.round(rect.right), vw });
      }
    }

    const tinyTargets = [];
    for (const el of root.querySelectorAll("button,a,[role='button']")) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.height < 44 || rect.width < 44) {
        tinyTargets.push({
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }

    const kpiGrid = document.querySelector('[data-testid="dashboard-kpi-grid"]');
    const kpiCards = kpiGrid
      ? [...kpiGrid.querySelectorAll("[data-testid^='dashboard-kpi-']")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !el.dataset.testid?.includes("skeleton");
        })
      : [];
    const kpiHeights = kpiCards.map((el) => Math.round(el.getBoundingClientRect().height));
    const kpiCols = kpiGrid ? window.getComputedStyle(kpiGrid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;

    const quickGrid = document.querySelector('[data-testid="dashboard-quick-actions-grid"]');
    const quickButtons = quickGrid
      ? [...quickGrid.querySelectorAll("[data-testid^='dashboard-quick-action-']")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
      : [];
    const quickHeights = quickButtons.map((el) => Math.round(el.getBoundingClientRect().height));
    const quickCols = quickGrid ? window.getComputedStyle(quickGrid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;

    const activitySection = document.querySelector('[data-activity-mobile="hidden"]');
    const activityVisible = activitySection
      ? window.getComputedStyle(activitySection).display !== "none"
      : false;

    return {
      horizontalOverflow,
      offScreen: offScreen.slice(0, 5),
      tinyTargets: tinyTargets.slice(0, 8),
      kpiCount: kpiCards.length,
      kpiHeights,
      uniformKpiHeights: kpiHeights.length > 0 && Math.max(...kpiHeights) - Math.min(...kpiHeights) <= 4,
      kpiCols,
      quickActionCount: quickButtons.length,
      quickHeights,
      uniformQuickHeights: quickHeights.length > 0 && Math.max(...quickHeights) - Math.min(...quickHeights) <= 6,
      quickCols,
      hasHero: Boolean(document.querySelector('[data-testid="natalie-morning-brief"]')),
      hasStatusPill: Boolean(document.querySelector('[data-testid="dashboard-status-pill"]')),
      hasToday: Boolean(document.querySelector("#natalie-decisions")),
      activityVisible,
      expectedActivityVisible: vp.width >= 768,
      authenticated: !location.pathname.includes("/login"),
    };
  }, viewport);
}

const report = { authMode: null, base: BASE, viewports: [] };

await assertDashboardServerReady(BASE);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "he-IL" });
const authMode = await prepareAuthenticatedDashboard(context, null, { apiUrl: API_URL });
report.authMode = authMode.mode;

for (const vp of VIEWPORTS) {
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const row = { viewport: vp.id, width: vp.width };
  try {
    await openAuthenticatedDashboard(page, BASE);
    await page.waitForTimeout(1500);
    row.analysis = await analyze(page, vp);
    const shot = path.join(OUT, `dashboard-${vp.id}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    row.screenshot = path.relative(path.join(__dirname, ".."), shot).replace(/\\/g, "/");
    const a = row.analysis;
    row.checks = {
      authenticated: a.authenticated && a.hasHero,
      noHorizontalOverflow: !a.horizontalOverflow,
      noOffScreenControls: a.offScreen.length === 0,
      touchTargetsOk: a.tinyTargets.length === 0,
      kpiCountFour: a.kpiCount === 4,
      kpiColumns: a.kpiCols === vp.kpiCols,
      uniformKpiHeights: a.uniformKpiHeights,
      quickActionCountThree: a.quickActionCount === 3,
      quickColumns: a.quickCols === vp.quickCols,
      uniformQuickHeights: a.uniformQuickHeights,
      activityVisibility: a.activityVisible === a.expectedActivityVisible,
      statusPillPresent: a.hasStatusPill,
      todayPresent: a.hasToday,
    };
    row.status = Object.values(row.checks).every(Boolean) ? "pass" : "fail";
  } catch (err) {
    row.status = "error";
    row.error = String(err.message || err);
  }
  report.viewports.push(row);
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failed = report.viewports.filter((row) => row.status !== "pass");
if (failed.length > 0) {
  process.exitCode = 1;
}
