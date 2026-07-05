const url = "https://ai-office-worker-frontend.onrender.com/dashboard";
const oldBuild = "FCGh1DfQLHu1eMuK_fINC";
const maxAttempts = Number(process.env.POLL_ATTEMPTS ?? 40);
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe() {
  const res = await fetch(url, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  const html = await res.text();
  return {
    at: new Date().toISOString(),
    httpStatus: res.status,
    pageChunk: (html.match(/app\/dashboard\/page-([a-f0-9]+)\.js/) || [])[1] ?? null,
    buildId: (html.match(/<!--([A-Za-z0-9_-]+)-->/) || [])[1] ?? null,
    hasStatusPill: html.includes("dashboard-status-pill"),
    hasQuickActionsGrid: html.includes("dashboard-quick-actions-grid"),
    hasLegacyAsk: html.includes("מה תרצה שאעשה"),
    hasLegacySystemHealth: html.includes("מצב המערכת"),
    phase7Plus:
      html.includes("dashboard-status-pill") && html.includes("dashboard-quick-actions-grid"),
  };
}

for (let i = 1; i <= maxAttempts; i++) {
  let result;
  try {
    result = await probe();
  } catch (err) {
    result = { error: String(err.message || err) };
  }
  const line = {
    attempt: i,
    ...result,
    changedFromOldBuild: Boolean(result.buildId && result.buildId !== oldBuild),
    deployReady: Boolean(result.phase7Plus),
  };
  console.log(JSON.stringify(line));
  if (result.phase7Plus) process.exit(0);
  if (i < maxAttempts) await sleep(intervalMs);
}

process.exit(1);
