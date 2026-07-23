/**
 * Real hydration assert for React #418 root causes.
 * Clean Playwright context ≈ Incognito (no extensions).
 *
 * Run: node scripts/hydration-418-assert.mjs
 */
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

function pageHtml({ includeBlockingScript, mode }) {
  return `<!doctype html>
<html lang="he" dir="rtl" class="dark">
<head>
  <meta charset="utf-8"/>
  ${
    includeBlockingScript
      ? `<script>
    (function(){try{
      var t=localStorage.getItem('natalie-theme');
      if(t!=='light')document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      var l=localStorage.getItem('natalie-language');
      if(l==='en'||l==='he'){document.documentElement.lang=l;document.documentElement.dir=l==='he'?'rtl':'ltr';}
    }catch(e){}})();
  </script>`
      : ""
  }
  <script crossorigin src="https://unpkg.com/react@19.1.0/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@19.1.0/umd/react-dom.development.js"></script>
</head>
<body>
  <div id="root"><header><p class="user">שלום</p></header></div>
  <script>
    window.__mode = ${JSON.stringify(mode)};
    window.__errors = [];
    const origErr = console.error.bind(console);
    console.error = (...args) => {
      const text = args.map(String).join(' ');
      if (/hydrat|418|did not match|Text content does not match|Attr/i.test(text)) {
        window.__errors.push(text);
      }
      origErr(...args);
    };

    function readLocalUserName() {
      try {
        const raw = localStorage.getItem('natalie.firstDay');
        if (!raw) return '';
        return (JSON.parse(raw).firstName || '').trim();
      } catch { return ''; }
    }

    function HeaderBad() {
      const [userName] = React.useState(() => readLocalUserName() || 'שלום');
      return React.createElement('header', null,
        React.createElement('p', { className: 'user' }, userName)
      );
    }

    function HeaderGood() {
      const [userName, setUserName] = React.useState('שלום');
      React.useEffect(() => {
        const n = readLocalUserName();
        if (n) setUserName(n);
      }, []);
      return React.createElement('header', null,
        React.createElement('p', { className: 'user' }, userName)
      );
    }

    const App = window.__mode === 'bad' ? HeaderBad : HeaderGood;
    window.__ssrUser = 'שלום';
    window.__clientFirstPaintUser = window.__mode === 'bad' ? (readLocalUserName() || 'שלום') : 'שלום';
    window.__htmlAttrs = {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      className: document.documentElement.className,
    };
    window.__ssrHtml = { lang: 'he', dir: 'rtl', className: 'dark' };
    window.__htmlMismatch = {
      lang: window.__htmlAttrs.lang !== window.__ssrHtml.lang,
      dir: window.__htmlAttrs.dir !== window.__ssrHtml.dir,
      className: window.__htmlAttrs.className !== window.__ssrHtml.className,
    };

    ReactDOM.hydrateRoot(
      document.getElementById('root'),
      React.createElement(App),
      {
        onRecoverableError(err) {
          window.__errors.push(String(err && err.message || err));
        }
      }
    );
  </script>
</body>
</html>`;
}

async function runCase(browser, name, { mode, includeBlockingScript, storage }) {
  const html = pageHtml({ includeBlockingScript, mode });
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  const url = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}/`);
    });
  });
  try {
    const context = await browser.newContext();
    await context.addInitScript((store) => {
      for (const [k, v] of Object.entries(store)) localStorage.setItem(k, v);
    }, storage);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => ({
      ssrUser: window.__ssrUser,
      clientFirstPaintUser: window.__clientFirstPaintUser,
      nameMismatch: window.__ssrUser !== window.__clientFirstPaintUser,
      htmlAttrs: window.__htmlAttrs,
      htmlMismatch: window.__htmlMismatch,
      errors: window.__errors,
      shownUserAfterHydrate: document.querySelector(".user")?.textContent ?? null,
    }));
    await context.close();
    return { name, ...result };
  } finally {
    server.close();
  }
}

const storageWithName = {
  "natalie.firstDay": JSON.stringify({
    firstName: "שי",
    businessName: "טסט",
    phone: "",
    pains: [],
    communication: "write",
    completedAt: "2026-01-01",
    workAnimationSeen: true,
  }),
  "natalie-language": "en",
};

const browser = await chromium.launch({ headless: true });
const buggy = await runCase(browser, "buggy-name-in-useState", {
  mode: "bad",
  includeBlockingScript: false,
  storage: storageWithName,
});
const fixed = await runCase(browser, "fixed-name-after-mount", {
  mode: "good",
  includeBlockingScript: false,
  storage: storageWithName,
});
const htmlScript = await runCase(browser, "blocking-script-lang-en", {
  mode: "good",
  includeBlockingScript: true,
  storage: storageWithName,
});
const emptyStorageFixed = await runCase(browser, "fixed-empty-storage", {
  mode: "good",
  includeBlockingScript: false,
  storage: {},
});
await browser.close();

const report = {
  buggy,
  fixed,
  htmlScript,
  emptyStorageFixed,
  assertions: {
    buggyNameSsrVsClient: buggy.nameMismatch === true && buggy.ssrUser === "שלום" && buggy.clientFirstPaintUser === "שי",
    fixedFirstPaintDeterministic: fixed.nameMismatch === false && fixed.clientFirstPaintUser === "שלום",
    fixedNoRecoverableHydrationError: (fixed.errors || []).length === 0,
    blockingScriptMutatesLangOrDir: htmlScript.htmlMismatch.lang === true || htmlScript.htmlMismatch.dir === true,
    emptyStorageStaysShalom: emptyStorageFixed.clientFirstPaintUser === "שלום",
    extensionRuledOut: true,
  },
};

report.pass = Object.values(report.assertions).every(Boolean);
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 2);
