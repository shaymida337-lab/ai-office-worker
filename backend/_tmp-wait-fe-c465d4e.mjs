/** Wait until FE bundle serves commit c465d4e. No Render API, no auth. */
const WANT = "c465d4e";
const FE = "https://ai-office-worker-frontend.onrender.com";
const start = Date.now();
const timeoutMs = 25 * 60 * 1000;

async function text(url) {
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function scriptUrls(html) {
  return [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s>]+\.js/g)].map((m) => m[0]))];
}

async function once() {
  const html = await text(`${FE}/login`);
  const hasBlockingThemeScript = html.includes("natalie-theme") && html.includes("localStorage.getItem");
  const htmlTag = (html.match(/<html[^>]*>/) || [])[0] || "";
  const hasDarkClassOnHtml = /class="[^"]*\bdark\b/.test(htmlTag) || htmlTag.includes('className="dark"');
  // Next serializes className as class=
  const ssrDark = /<html[^>]*\bclass="[^"]*\bdark\b/.test(html);
  const scripts = scriptUrls(html);
  let commit = null;
  for (const s of scripts.slice(0, 40)) {
    let js;
    try {
      js = await text(`${FE}${s}`);
    } catch {
      continue;
    }
    if (js.includes(WANT)) commit = WANT;
  }
  return {
    commit,
    scripts: scripts.length,
    hasBlockingThemeScript,
    ssrDark,
    htmlTag,
  };
}

while (Date.now() - start < timeoutMs) {
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  try {
    const hit = await once();
    console.log(JSON.stringify({ elapsedSec, ...hit }));
    // Live when commit SHA present AND blocking script gone AND ssr dark present
    if (hit.commit === WANT && hit.hasBlockingThemeScript === false && hit.ssrDark === true) {
      console.log(JSON.stringify({ status: "FRONTEND_LIVE", commit: WANT, elapsedSec }));
      process.exit(0);
    }
  } catch (e) {
    console.log(JSON.stringify({ elapsedSec, error: String(e.message || e) }));
  }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log(JSON.stringify({ status: "TIMEOUT", commit: WANT }));
process.exit(2);
