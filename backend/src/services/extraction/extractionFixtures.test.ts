import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixtureEvidenceFromText,
  computeExtractionFixtureMetrics,
  evaluateExtractionFixture,
  loadExtractionFixtureManifest,
  loadExtractionFixtureText,
} from "./extractionFixtures.js";

test("Delivery 9: extraction fixture dataset — 100% field accuracy on deterministic fixtures", () => {
  const manifest = loadExtractionFixtureManifest();
  assert.equal(manifest.fixtures.length, 15);

  const results = manifest.fixtures.map((fixture) => {
    const text = loadExtractionFixtureText(fixture);
    const evidence = buildFixtureEvidenceFromText(text);
    const evaluation = evaluateExtractionFixture(fixture, evidence);
    return { fixture, ...evaluation };
  });

  const failed = results.filter((result) => !result.passed);
  const metrics = computeExtractionFixtureMetrics(results);

  for (const metric of metrics) {
    assert.equal(metric.incorrect, 0, `${metric.field} incorrect`);
    assert.equal(metric.missingWhenExpected, 0, `${metric.field} missingWhenExpected`);
    assert.equal(metric.falsePositive, 0, `${metric.field} falsePositive`);
  }

  assert.equal(
    failed.length,
    0,
    failed.map((result) => `${result.fixture.id}: ${result.failures.join("; ")}`).join("\n")
  );
});
