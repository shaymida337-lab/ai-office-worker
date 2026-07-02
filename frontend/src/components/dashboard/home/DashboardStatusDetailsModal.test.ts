import assert from "node:assert/strict";
import test from "node:test";

test("DashboardStatusDetailsModal is accessible and closable", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/components/dashboard/home/DashboardStatusDetailsModal.tsx", "utf8");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /id="dashboard-status-modal-title"/);
  assert.match(source, /מצב המערכת/);
  assert.match(source, /Escape/);
  assert.match(source, /onClick=\{onClose\}/);
  assert.match(source, /healthRows\.map/);
  assert.match(source, /MODAL_HEALTH_LABEL/);
  assert.match(source, /ScanBanner/);
  assert.match(source, /data-testid="dashboard-status-modal"/);
});
