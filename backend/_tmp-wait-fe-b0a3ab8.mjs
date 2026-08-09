/** Wait until Render frontend serves commit b0a3ab8 with DASHBOARD_FP_DEBUG marker. */
const SITE = "https://ai-office-worker-frontend.onrender.com";
const WANT = "b0a3ab8";
const DEADLINE_MS = 20 * 60 * 1000;
const start = Date.now();

async function text(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function scriptPaths(html) {
  return [...html.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].map((m) => m[0]);
}

function unique(arr) {
  return [...new Set(arr)];
}

while (Date.now() - start < DEADLINE_MS) {
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  try {
    const html = await text(`${SITE}/dashboard`);
    const scripts = unique(scriptPaths(html));
    let commit = null;
    let fp = false;
    let fpUrl = null;

    for (const s of scripts) {
      if (!/1959-|main-app-/.test(s)) continue;
      const js = await text(`${SITE}${s}`);
      for (const c of ["b0a3ab8", "014319b", "1405fc7"]) {
        if (js.includes(c)) commit = c;
      }
    }

    for (const s of scripts) {
      if (!s.includes("/app/dashboard/page-") && !s.includes("useDashboardHome")) continue;
      const js = await text(`${SITE}${s}`);
      if (js.includes("DASHBOARD_FP_DEBUG") || js.includes("[dashboard-fp]")) {
        fp = true;
        fpUrl = `${SITE}${s}`;
      }
    }

    // If commit advanced, scan all scripts for the marker (chunk may not be page-*).
    if (commit === WANT && !fp) {
      for (const s of scripts) {
        const js = await text(`${SITE}${s}`);
        if (js.includes("DASHBOARD_FP_DEBUG") || js.includes("[dashboard-fp]")) {
          fp = true;
          fpUrl = `${SITE}${s}`;
          break;
        }
      }
    }

    console.log(JSON.stringify({ elapsedSec, commit, fp, scripts: scripts.length, fpUrl }));
    if (commit === WANT && fp) {
      console.log(JSON.stringify({ status: "DEPLOY_LIVE", commit: WANT, fpUrl }));
      process.exit(0);
    }
  } catch (err) {
    console.log(JSON.stringify({ elapsedSec, error: String(err?.message || err) }));
  }
  await new Promise((r) => setTimeout(r, 40000));
}

console.log(JSON.stringify({ status: "NOT_LIVE_TIMEOUT", lookingFor: WANT }));
process.exit(1);
