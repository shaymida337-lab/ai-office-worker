/** Wait until Render FE serves commit 657c505 / M2 marker. No Render API, no auth. */
const SITE = "https://ai-office-worker-frontend.onrender.com";
const WANT = "657c505";
const MARKERS = ["ORGANIZATION_SETTINGS_FRESH_MS", "organizationSettingsCacheClear", "loadOrganizationSettings"];
const start = Date.now();
const timeoutMs = 20 * 60 * 1000;

async function text(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function scripts(html) {
  return [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].map((m) => m[0]))];
}

while (Date.now() - start < timeoutMs) {
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  try {
    const html = await text(`${SITE}/dashboard`);
    const list = scripts(html);
    let commit = null;
    let marker = null;
    let markerUrl = null;

    for (const s of list) {
      if (!/1959-|main-app-/.test(s)) continue;
      const js = await text(`${SITE}${s}`);
      for (const c of [WANT, "b0a3ab8", "014319b"]) {
        if (js.includes(c)) commit = c;
      }
    }

    for (const s of list) {
      const js = await text(`${SITE}${s}`);
      for (const m of MARKERS) {
        if (js.includes(m)) {
          marker = m;
          markerUrl = `${SITE}${s}`;
          break;
        }
      }
      if (marker) break;
    }

    console.log(JSON.stringify({ elapsedSec, commit, marker, scripts: list.length, markerUrl }));
    if (commit === WANT && marker) {
      console.log(JSON.stringify({ status: "DEPLOY_LIVE", commit: WANT, marker, markerUrl }));
      process.exit(0);
    }
  } catch (err) {
    console.log(JSON.stringify({ elapsedSec, error: String(err?.message || err) }));
  }
  await new Promise((r) => setTimeout(r, 40000));
}

console.log(JSON.stringify({ status: "NOT_LIVE_TIMEOUT", lookingFor: WANT }));
process.exit(1);
