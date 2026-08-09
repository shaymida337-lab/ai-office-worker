import { readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "@playwright/test";

async function main() {
  const token = readFileSync(join(process.cwd(), "../backend/.tmp-shay-token.txt"), "utf8").trim();
  const outDir = join(process.cwd(), "../.evidence-crm-search");
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
  await page.goto("http://localhost:3000/crm", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const top = page.getByPlaceholder("חפש לקוח, מסמך, חשבונית, משימה...");
  await top.click();
  await top.fill("שרית");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(outDir, "top-search-sarit.png"), fullPage: true });
  // Dropdown result title (not input value — input values are absent from innerText)
  const topResultCount = await page.locator("button").filter({ hasText: "שרית" }).count();

  await top.fill("");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const bottom = page.getByTestId("crm-search-input");
  await bottom.click();
  await bottom.fill("שרית");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(outDir, "bottom-search-sarit.png"), fullPage: true });
  const bottomCardCount = await page.getByRole("heading", { name: "שרית" }).count();

  const ok = topResultCount > 0 && bottomCardCount > 0;
  console.log(JSON.stringify({ topResultCount, bottomCardCount, ok }, null, 2));
  await browser.close();
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
