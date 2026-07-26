import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInvoiceGoldenTable,
  runInvoiceGoldenDataset,
  runInvoiceGoldenFixture,
  loadInvoiceGoldenManifest,
} from "./invoiceGoldenRunner.js";

test("invoice golden manifest loads exactly 20 fixtures", () => {
  const manifest = loadInvoiceGoldenManifest();
  assert.equal(manifest.version, "invoice-golden-v1");
  assert.equal(manifest.fixtures.length, 20);
  const ids = new Set(manifest.fixtures.map((f) => f.id));
  assert.equal(ids.size, 20);
  for (const fixture of manifest.fixtures) {
    assert.ok(fixture.id, "fixture id required");
    assert.ok(fixture.file, "fixture file required");
    assert.ok(fixture.expected, "fixture expected required");
    assert.ok(
      ["invoices", "completion", "excluded"].includes(fixture.expected.destination),
      `invalid destination for ${fixture.id}`
    );
  }
});

test("invoice golden runner produces a full baseline report without throwing", () => {
  const report = runInvoiceGoldenDataset();
  assert.equal(report.results.length, 20);
  assert.ok(report.tableMarkdown.includes("| fixture |"));
  assert.equal(report.totals.passed + report.totals.failed, 20);

  // Explicit baseline lock — do not "green" failures by weakening expected.
  // Missing-supplier metadata filter raised 17/20 → 18/20.
  assert.equal(report.totals.passed, 18, "golden baseline passed count drifted");
  assert.equal(report.totals.failed, 2, "golden baseline failed count drifted");

  const missingSupplier = report.results.find((r) => r.fixtureId === "he_missing_supplier_001");
  assert.ok(missingSupplier);
  assert.equal(missingSupplier!.passed, true);
  assert.equal(missingSupplier!.actual.supplierName, null);
  assert.equal(missingSupplier!.actual.destination, "completion");
  assert.ok(missingSupplier!.actual.missingDataReasons.includes("ספק לא זוהה"));

  // Every fixture file referenced by the manifest must exist and run.
  for (const result of report.results) {
    assert.ok(result.fixtureId, "fixture id missing");
    assert.ok(result.expected, "expected missing");
    assert.ok(result.actual, "actual missing");
  }

  // Camera draft routing must stay on completion (hardening regression).
  const camera = report.results.find((r) => r.fixtureId === "he_camera_draft_complete_001");
  assert.ok(camera);
  assert.equal(camera!.actual.destination, "completion");

  // Duplicate unsure routing must stay on completion.
  const dup = report.results.find((r) => r.fixtureId === "he_duplicate_unsure_001");
  assert.ok(dup);
  assert.equal(dup!.actual.destination, "completion");

  // Non-financial must not land on invoices.
  const nonFin = report.results.find((r) => r.fixtureId === "en_non_financial_001");
  assert.ok(nonFin);
  assert.notEqual(nonFin!.actual.destination, "invoices");

  console.log("\n" + formatInvoiceGoldenTable(report.results));
  console.log(
    `\ngolden baseline: passed=${report.totals.passed} failed=${report.totals.failed} extractionFailures=${report.totals.extractionFailures} routingFailures=${report.totals.routingFailures} FP=${report.totals.falsePositives} FN=${report.totals.falseNegatives}`
  );
  console.log(`byKind=${JSON.stringify(report.totals.byKind)}`);
  for (const result of report.results.filter((r) => !r.passed)) {
    console.log(
      `FAIL ${result.fixtureId}: expected=${JSON.stringify(result.expected)} actual=${JSON.stringify({
        supplierName: result.actual.supplierName,
        amount: result.actual.amount,
        currency: result.actual.currency,
        invoiceDate: result.actual.invoiceDate,
        documentType: result.actual.documentType,
        destination: result.actual.destination,
        missingDataReasons: result.actual.missingDataReasons,
      })} :: ${result.failures.map((f) => f.message).join("; ")}`
    );
  }
});

test("invoice golden single fixture run is deterministic across 2 calls", () => {
  const manifest = loadInvoiceGoldenManifest();
  const fixture = manifest.fixtures.find((f) => f.id === "he_invoice_clear_001");
  assert.ok(fixture);
  const a = runInvoiceGoldenFixture(fixture!);
  const b = runInvoiceGoldenFixture(fixture!);
  assert.deepEqual(a.actual, b.actual);
  assert.equal(a.passed, b.passed);
});
