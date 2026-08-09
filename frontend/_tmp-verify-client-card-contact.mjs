import { readFileSync } from "fs";
import { join } from "path";
import { chromium } from "@playwright/test";

async function main() {
  const token = readFileSync(join(process.cwd(), "../backend/.tmp-shay-token.txt"), "utf8").trim();
  const headers = { Authorization: `Bearer ${token}` };
  const api = "https://ai-office-worker-backend.onrender.com";
  const clientsRes = await fetch(`${api}/api/clients`, { headers });
  const clientsJson = await clientsRes.json();
  const withContact = (clientsJson.clients ?? []).find(
    (c) => (c.phone || c.whatsappNumber) && c.email && !String(c.email).endsWith(".local")
  );
  if (!withContact) {
    console.log(JSON.stringify({ error: "no-client-with-full-contact", sample: (clientsJson.clients ?? []).slice(0, 5) }));
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20000);
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
  await page.goto(`http://localhost:3000/dashboard/clients/${withContact.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="client-actions"]');
  await page.waitForTimeout(1500);

  const callHref = await page.getByTestId("action-call").getAttribute("href");
  const waHref = await page.getByTestId("action-whatsapp").getAttribute("href");
  const emailHref = await page.getByTestId("action-email").getAttribute("href");
  const backHref = await page.getByTestId("back-to-clients").getAttribute("href");

  console.log(
    JSON.stringify(
      {
        client: { id: withContact.id, name: withContact.name },
        callHref,
        waHref,
        emailHref,
        backHref,
        ok:
          Boolean(callHref?.startsWith("tel:")) &&
          Boolean(waHref && /^https:\/\/wa\.me\/\d+$/.test(waHref)) &&
          Boolean(emailHref?.startsWith("mailto:")) &&
          backHref === "/dashboard/clients",
      },
      null,
      2
    )
  );
  await browser.close();
  if (
    !(
      callHref?.startsWith("tel:") &&
      waHref &&
      /^https:\/\/wa\.me\/\d+$/.test(waHref) &&
      emailHref?.startsWith("mailto:") &&
      backHref === "/dashboard/clients"
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
