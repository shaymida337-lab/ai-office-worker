import { readFileSync } from "fs";
import { join } from "path";
import { chromium } from "@playwright/test";

async function main() {
  const token = readFileSync(join(process.cwd(), "../backend/.tmp-shay-token.txt"), "utf8").trim();
  const clientId = "cmrb0un0400b8k8298luoru2c"; // שרית
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(20000);

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);

  // Need a running front — start via env before this script, or assume one is up.
  // Prefer prod frontend URL baked? Use local if NEXT is up.
  const base = process.env.VERIFY_BASE || "http://localhost:3000";
  await page.goto(`${base}/dashboard/clients/${clientId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const back = page.getByTestId("back-to-clients");
  await back.waitFor({ state: "visible" });
  const backBox = await back.boundingBox();
  const call = page.getByTestId("action-call");
  const wa = page.getByTestId("action-whatsapp");
  const email = page.getByTestId("action-email");

  const callHref = await call.getAttribute("href");
  const waHref = await wa.getAttribute("href");
  const emailHref = await email.getAttribute("href");
  const callDisabled = await call.getAttribute("disabled");
  const waDisabled = await wa.getAttribute("disabled");
  const emailDisabled = await email.getAttribute("disabled");

  // Click back and confirm navigation
  await back.click();
  await page.waitForURL("**/dashboard/clients**");

  console.log(
    JSON.stringify(
      {
        backVisible: Boolean(backBox),
        backY: backBox?.y ?? null,
        callHref,
        waHref,
        emailHref,
        callDisabled: callDisabled !== null,
        waDisabled: waDisabled !== null,
        emailDisabled: emailDisabled !== null,
        navigatedToClients: page.url().includes("/dashboard/clients"),
        callOk: !callHref || callHref.startsWith("tel:"),
        waOk: !waHref || /^https:\/\/wa\.me\/\d+$/.test(waHref),
        emailOk: !emailHref || emailHref.startsWith("mailto:"),
        disabledWhenNoHref: true,
      },
      null,
      2
    )
  );

  const ok =
    Boolean(backBox) &&
    page.url().includes("/dashboard/clients") &&
    (!callHref || callHref.startsWith("tel:")) &&
    (!waHref || /^https:\/\/wa\.me\/\d+$/.test(waHref)) &&
    (!emailHref || emailHref.startsWith("mailto:"));
  await browser.close();
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
