import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HistoricalScanSelector.tsx"), "utf8");
const invoicesPage = readFileSync(
  join(here, "../../app/dashboard/invoices/page.tsx"),
  "utf8"
);
const settingsPage = readFileSync(
  join(here, "../../app/dashboard/settings/page.tsx"),
  "utf8"
);
const businessSettingsPage = readFileSync(
  join(here, "../../app/dashboard/business-settings/page.tsx"),
  "utf8"
);

test("HistoricalScanSelector PATCHes organization settings with historicalScanYears", () => {
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /\/api\/organization\/settings/);
  assert.match(source, /historicalScanYears/);
});

test("HistoricalScanSelector exposes years 1 through 5", () => {
  assert.match(source, /\[1,\s*2,\s*3,\s*4,\s*5\]/);
});

test("HistoricalScanSelector starts a full historical Gmail scan after successful PATCH", () => {
  assert.match(source, /\/api\/gmail\/scan/);
  assert.match(source, /historical:\s*true/);
  assert.match(source, /fullScan:\s*true/);
  assert.match(source, /daysBack:\s*savedYears\s*\*\s*365/);
});

test("HistoricalScanSelector shows active scanning state and success copy", () => {
  assert.match(source, /isScanning/);
  assert.match(source, /סורק את Gmail כעת/);
  assert.match(source, /הסריקה הושלמה! נמצאו/);
  assert.match(source, /waitForOrgGmailScanProgress/);
  assert.match(source, /onScanComplete/);
});

test("HistoricalScanSelector is mounted on invoices page above Gmail action buttons", () => {
  assert.match(invoicesPage, /HistoricalScanSelector/);
  assert.match(invoicesPage, /data-testid="historical-scan-selector-slot"/);
  assert.match(invoicesPage, /onScanComplete/);
  assert.match(invoicesPage, /refreshMonthsAndInvoices/);
  const selectorIdx = invoicesPage.indexOf("<HistoricalScanSelector");
  const importIdx = invoicesPage.indexOf("invoicesDesign.importFile");
  const scanIdx = invoicesPage.indexOf("invoicesDesign.scanGmail");
  assert.ok(selectorIdx >= 0 && importIdx > selectorIdx && scanIdx > selectorIdx);
});

test("HistoricalScanSelector is removed from settings pages", () => {
  assert.doesNotMatch(settingsPage, /HistoricalScanSelector/);
  assert.doesNotMatch(businessSettingsPage, /HistoricalScanSelector/);
});
