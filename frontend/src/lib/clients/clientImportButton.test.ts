import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("clients page renders import button next to add client", async () => {
  const source = await readFile("src/app/dashboard/clients/page.tsx", "utf8");
  assert.match(source, /ייבוא לקוחות/);
  assert.match(source, /data-testid="clients-import-button"/);
  assert.match(source, /ImportClientsDialog/);
  const importIdx = source.indexOf("clients-import-button");
  const addIdx = source.indexOf("clients-add-button");
  assert.ok(addIdx > 0 && importIdx > 0);
  // Add button appears first, import immediately after in the same action row.
  assert.ok(addIdx < importIdx);
});

test("CRM page (ניהול לקוחות / הוסף לקוח) renders import clients button", async () => {
  const source = await readFile("src/app/crm/page.tsx", "utf8");
  assert.match(source, /crmDesign\.addCustomer/);
  assert.match(source, /ייבוא לקוחות/);
  assert.match(source, /data-testid="crm-import-clients"/);
  assert.match(source, /ImportClientsDialog/);
  const addIdx = source.indexOf("crmDesign.addCustomer");
  const importIdx = source.indexOf("crm-import-clients");
  assert.ok(addIdx > 0 && importIdx > addIdx);
});
