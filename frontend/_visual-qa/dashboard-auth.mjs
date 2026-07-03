import { assertDashboardServerReady, isDashboardServerErrorBody } from "./dashboard-qa-guard.mjs";

const TEST_TOKEN = process.env.VISUAL_QA_TOKEN ?? "visual-qa-dashboard-token";

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function emptyStats() {
  return {
    moneyToPay: 4200,
    moneyToReceive: 12500,
    pendingInvoices: 3,
    missingInvoicesCount: 0,
    upcomingPaymentsCount: 1,
    openTasks: 2,
    unreadAlerts: 0,
    businessHealthScore: 92,
    totalInvoices: 12,
    currency: "ILS",
  };
}

function orgSettings() {
  return {
    id: "org-visual-qa",
    name: "העסק שלי",
    businessName: "העסק שלי",
    businessType: "service_business",
    enabledModules: ["crm", "invoices", "tasks"],
    onboardingCompleted: true,
    onboardingRequired: false,
    recommendedModules: ["crm"],
    locale: "he",
    currency: "ILS",
    timezone: "Asia/Jerusalem",
  };
}

function briefingSnapshot() {
  return {
    engineReadEnabled: false,
    upcoming: [],
    pendingDecisions: [],
    todaySummary: {
      upcomingCount: 0,
      pendingDecisionCount: 0,
      todayCompletedCount: 0,
      todayNoShowCount: 0,
      todayCancelledCount: 0,
    },
  };
}

export async function injectDashboardAuth(context, token = TEST_TOKEN) {
  await context.addInitScript((value) => {
    localStorage.setItem("token", value);
  }, token);
}

export async function installDashboardApiMocks(page) {
  if (!page) return;

  await page.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith("/api/stats")) return json(route, 200, emptyStats());
    if (path.endsWith("/api/summary/daily")) return json(route, 200, { text: "סיכום יומי לבדיקה" });
    if (path.endsWith("/api/organization/settings")) return json(route, 200, orgSettings());
    if (path.endsWith("/api/clients") || path.endsWith("/api/clients/")) {
      return json(route, 200, {
        clients: [{ id: "c1", name: "לקוח לדוגמה", stats: { toPay: 0, invoices: 1, missingInvoices: 0 } }],
      });
    }
    if (path.includes("/api/integrations/gmail/status")) {
      return json(route, 200, {
        googleConfigured: true,
        connected: true,
        connectedAt: new Date().toISOString(),
        reconnectRequired: false,
        missingDriveScopes: [],
      });
    }
    if (path.endsWith("/api/automation/scan-status")) {
      return json(route, 200, {
        logs: [],
        last: {
          id: "scan-1",
          type: "gmail",
          status: "success",
          found: 8,
          saved: 3,
          errors: null,
          startedAt: new Date(Date.now() - 120_000).toISOString(),
          endedAt: new Date().toISOString(),
        },
        nextScheduledScanAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    }
    if (path.endsWith("/api/payments") || path.endsWith("/api/reports/missing-invoices")) return json(route, 200, []);
    if (path.endsWith("/api/invoices")) return json(route, 200, { invoices: [] });
    if (path.endsWith("/api/tasks")) return json(route, 200, []);
    if (path.endsWith("/api/alerts")) return json(route, 200, []);
    if (path.includes("/api/document-reviews")) return json(route, 200, []);
    if (path.endsWith("/api/accountant/summary")) return json(route, 200, { connected: false });
    if (path.endsWith("/api/system/health")) {
      return json(route, 200, {
        ok: true,
        allPassed: true,
        components: {
          gmail: { connected: true, label: "Gmail", reason: null },
          drive: { connected: true, label: "Drive", reason: null },
          sheets: { connected: true, label: "Sheets", reason: null },
          whatsapp: { connected: false, label: "WhatsApp", reason: null },
          database: { connected: true, label: "Database", reason: null },
        },
      });
    }
    if (path.endsWith("/api/whatsapp-assistant/stats")) return json(route, 200, { sentToday: 0, activeChats: 0 });
    if (path.endsWith("/api/scheduling/briefing")) return json(route, 200, briefingSnapshot());
    if (path.endsWith("/api/scheduling/capabilities")) {
      return json(route, 200, { engineReadEnabled: false, engineWriteEnabled: false, source: "legacy" });
    }

    return json(route, 200, {});
  });
}

export async function loginDashboardViaApi(context, page, { apiUrl, email, password }) {
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Login failed (${res.status})`);
  await injectDashboardAuth(context, data.token);
  if (page && process.env.VISUAL_QA_MOCK_API !== "0") {
    await installDashboardApiMocks(page);
  }
  return data.token;
}

export async function prepareAuthenticatedDashboard(context, page, { apiUrl = process.env.VISUAL_QA_API ?? "http://localhost:4000" } = {}) {
  const email = process.env.VISUAL_QA_EMAIL;
  const password = process.env.VISUAL_QA_PASSWORD;

  if (process.env.VISUAL_QA_TOKEN) {
    await injectDashboardAuth(context, process.env.VISUAL_QA_TOKEN);
    if (page && process.env.VISUAL_QA_MOCK_API !== "0") {
      await installDashboardApiMocks(page);
    }
    return { mode: "token" };
  }

  if (email && password) {
    await loginDashboardViaApi(context, page, { apiUrl, email, password });
    return { mode: "live-login" };
  }

  await injectDashboardAuth(context);
  return { mode: "mock-auth" };
}

export async function openAuthenticatedDashboard(page, base) {
  await assertDashboardServerReady(base);
  await installDashboardApiMocks(page);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate((token) => {
    localStorage.setItem("token", token);
  }, process.env.VISUAL_QA_TOKEN ?? TEST_TOKEN);
  const dashboardResponse = await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const status = dashboardResponse?.status() ?? 0;
  if (status >= 500) {
    throw new Error(
      `Dashboard returned HTTP ${status} at ${base}/dashboard. Clear .next, rebuild, and use PORT=3011 npm run start.`
    );
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (isDashboardServerErrorBody(bodyText)) {
    throw new Error(
      `Dashboard page shows server error at ${base}/dashboard. Remove frontend/.next and run a clean production build.`
    );
  }
  await page.waitForSelector('[data-testid="natalie-morning-brief"]', { timeout: 60_000 });
  const url = page.url();
  if (url.includes("/login") || url === `${base}/` || url === `${base}`) {
    throw new Error(
      "Authentication failed: dashboard did not load. Provide VISUAL_QA_TOKEN or VISUAL_QA_EMAIL/VISUAL_QA_PASSWORD."
    );
  }
}
