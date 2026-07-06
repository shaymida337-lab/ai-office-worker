import { loadGoldenDataset } from "../src/services/golden/goldenDataset.js";
import { runGoldenCase } from "../src/services/golden/goldenRunner.js";

const ds = loadGoldenDataset();
for (const id of ["gd-001-perfect-tax-invoice", "gd-009-vat-mismatch", "gd-011-bezeq-utility"]) {
  const c = ds.cases.find((x) => x.id === id);
  if (!c) continue;
  const r = runGoldenCase(c);
  console.log(JSON.stringify({ id, passed: r.passed, failures: r.failures, actual: r.actual }, null, 2));
}
