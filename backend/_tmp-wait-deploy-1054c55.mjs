/** Wait until BE health + FE bundle serve commit 1054c55. No Render API, no auth. */
const WANT = "1054c55";
const BE = "https://ai-office-worker-backend.onrender.com/health";
const FE = "https://ai-office-worker-frontend.onrender.com";
const MARKERS = [
  "leadAdminSummaryStore",
  "loadIsPlatformAdmin",
  "/api/auth/platform-admin",
  "platform-admin",
];
const start = Date.now();
const timeoutMs = 25 * 60 * 1000;

async function beOnce() {
  const res = await fetch(BE, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  const commit = String(body.commit ?? body.commitSha ?? body.gitCommit ?? "");
  return {
    ok: res.status === 200,
    commit: commit.slice(0, 7),
    status: body.status,
    database: body.database,
  };
}

async function text(url) {
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function scriptUrls(html) {
  const out = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s>]+\.js/g)) out.add(m[0]);
  return [...out];
}

async function feOnce() {
  const html = await text(`${FE}/login`);
  const scripts = scriptUrls(html);
  let commit = null;
  const found = [];
  const prefer = scripts.filter((s) => /1959-|main-app-|layout-|webpack-/.test(s));
  const order = [...prefer, ...scripts.filter((s) => !prefer.includes(s))];

  for (const s of order.slice(0, 50)) {
    let js;
    try {
      js = await text(`${FE}${s}`);
    } catch {
      continue;
    }
    if (js.includes(WANT)) commit = WANT;
    for (const m of MARKERS) {
      if (js.includes(m) && !found.includes(m)) found.push(m);
    }
    if (commit === WANT && found.length >= 1) break;
  }
  return { commit, markers: found, scripts: scripts.length };
}

let beLive = false;
let feLive = false;

while (Date.now() - start < timeoutMs) {
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  if (!beLive) {
    try {
      const be = await beOnce();
      console.log(JSON.stringify({ elapsedSec, service: "backend", ...be }));
      if (be.ok && be.commit === WANT && be.status === "ok") beLive = true;
    } catch (e) {
      console.log(JSON.stringify({ elapsedSec, service: "backend", error: String(e.message || e) }));
    }
  } else {
    console.log(JSON.stringify({ elapsedSec, service: "backend", live: true, commit: WANT }));
  }

  if (!feLive) {
    try {
      const fe = await feOnce();
      console.log(JSON.stringify({ elapsedSec, service: "frontend", ...fe }));
      // Commit SHA in bundle is enough proof of FE deploy; markers optional if minified away.
      if (fe.commit === WANT) feLive = true;
    } catch (e) {
      console.log(JSON.stringify({ elapsedSec, service: "frontend", error: String(e.message || e) }));
    }
  } else {
    console.log(JSON.stringify({ elapsedSec, service: "frontend", live: true, commit: WANT }));
  }

  if (beLive && feLive) {
    console.log(JSON.stringify({ status: "BOTH_LIVE", commit: WANT, elapsedSec }));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 20000));
}

console.log(JSON.stringify({ status: "TIMEOUT", beLive, feLive, commit: WANT }));
process.exit(2);
