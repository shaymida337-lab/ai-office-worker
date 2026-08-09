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
  assert.match(source, /עומק הסריקה עודכן/);
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

test("HistoricalScanSelector is mounted on invoices page above filters", () => {
  assert.match(invoicesPage, /HistoricalScanSelector/);
  const selectorIdx = invoicesPage.indexOf("<HistoricalScanSelector");
  const filtersIdx = invoicesPage.indexOf("<InvoicesFiltersCard");
  assert.ok(selectorIdx >= 0 && filtersIdx > selectorIdx);
});

test("HistoricalScanSelector is removed from settings pages", () => {
  assert.doesNotMatch(settingsPage, /HistoricalScanSelector/);
  assert.doesNotMatch(businessSettingsPage, /HistoricalScanSelector/);
});
