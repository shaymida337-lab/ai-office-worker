import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFinancialIngestionAllowed,
  FinancialIngestionBlockedError,
  isAllowedInvoiceCompletionRead,
  isAllowedInvoiceListRead,
  isFinancialDataContainmentActive,
  isFinancialDataPath,
  isFinancialIngestionContainmentActive,
  isFinancialReadContainmentActive,
} from "./financialContainment.js";

const ENV_KEYS = [
  "FINANCIAL_DATA_CONTAINMENT",
  "FINANCIAL_READ_CONTAINMENT",
  "FINANCIAL_INGESTION_CONTAINMENT",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as EnvSnapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setEnv(master?: string, read?: string, ingestion?: string) {
  if (master === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
  else process.env.FINANCIAL_DATA_CONTAINMENT = master;
  if (read === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
  else process.env.FINANCIAL_READ_CONTAINMENT = read;
  if (ingestion === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
  else process.env.FINANCIAL_INGESTION_CONTAINMENT = ingestion;
}

test("isFinancialDataPath covers financial reads and ingestion routes", () => {
  assert.equal(isFinancialDataPath("/invoices"), true);
  assert.equal(isFinancialDataPath("/invoice-completion/list"), true);
  assert.equal(isFinancialDataPath("/payments"), true);
  assert.equal(isFinancialDataPath("/document-reviews"), true);
  assert.equal(isFinancialDataPath("/gmail/scan"), true);
  assert.equal(isFinancialDataPath("/gmail/scan/abc123"), true);
  assert.equal(isFinancialDataPath("/verification"), true);
  assert.equal(isFinancialDataPath("/dashboard/stats"), false);
});

test("isAllowedInvoiceListRead allows only GET invoices list and months", () => {
  assert.equal(isAllowedInvoiceListRead("GET", "/invoices"), true);
  assert.equal(isAllowedInvoiceListRead("get", "/invoices/months"), true);
  assert.equal(isAllowedInvoiceListRead("GET", "/invoices/abc"), false);
  assert.equal(isAllowedInvoiceListRead("GET", "/payments"), false);
  assert.equal(isAllowedInvoiceListRead("POST", "/invoices"), false);
  assert.equal(isAllowedInvoiceListRead("PUT", "/invoices/months"), false);
});

test("isAllowedInvoiceCompletionRead allows only GET completion bootstrap/list", () => {
  assert.equal(isAllowedInvoiceCompletionRead("GET", "/invoice-completion/bootstrap"), true);
  assert.equal(isAllowedInvoiceCompletionRead("GET", "/invoice-completion/list"), true);
  assert.equal(isAllowedInvoiceCompletionRead("POST", "/invoice-completion/list"), false);
  assert.equal(isAllowedInvoiceCompletionRead("GET", "/invoice-completion/other"), false);
});

const TRUTH_TABLE: Array<{
  master?: string;
  read?: string;
  ingestion?: string;
  readBlocked: boolean;
  ingestionBlocked: boolean;
}> = [
  { master: "1", read: "0", ingestion: "0", readBlocked: true, ingestionBlocked: true },
  { master: "1", read: "0", ingestion: "1", readBlocked: true, ingestionBlocked: true },
  { master: "1", read: "1", ingestion: "0", readBlocked: true, ingestionBlocked: true },
  { master: "0", read: "1", ingestion: "1", readBlocked: true, ingestionBlocked: true },
  { master: "0", read: "0", ingestion: "1", readBlocked: false, ingestionBlocked: true },
  { master: "0", read: "1", ingestion: "0", readBlocked: true, ingestionBlocked: false },
  { master: "0", read: "0", ingestion: "0", readBlocked: false, ingestionBlocked: false },
  { readBlocked: true, ingestionBlocked: true },
];

for (const [index, row] of TRUTH_TABLE.entries()) {
  test(`truth table row ${index + 1}`, () => {
    const previous = snapshotEnv();
    setEnv(row.master, row.read, row.ingestion);
    try {
      assert.equal(isFinancialReadContainmentActive(), row.readBlocked);
      assert.equal(isFinancialIngestionContainmentActive(), row.ingestionBlocked);
    } finally {
      restoreEnv(previous);
    }
  });
}

const PARSING_CASES: Array<{ value?: string; expected: boolean }> = [
  { value: "1", expected: true },
  { value: "true", expected: true },
  { value: "TRUE", expected: true },
  { value: "yes", expected: true },
  { value: "on", expected: true },
  { value: "  true  ", expected: true },
  { value: "0", expected: false },
  { value: "false", expected: false },
  { value: "bogus", expected: true },
  { expected: true },
];

for (const [index, row] of PARSING_CASES.entries()) {
  test(`read containment parsing case ${index + 1}`, () => {
    const previous = snapshotEnv();
    setEnv("0");
    if (row.value === undefined) delete process.env.FINANCIAL_READ_CONTAINMENT;
    else process.env.FINANCIAL_READ_CONTAINMENT = row.value;
    try {
      assert.equal(isFinancialReadContainmentActive(), row.expected);
    } finally {
      restoreEnv(previous);
    }
  });
}

for (const [index, row] of PARSING_CASES.entries()) {
  test(`ingestion containment parsing case ${index + 1}`, () => {
    const previous = snapshotEnv();
    setEnv("0");
    if (row.value === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = row.value;
    try {
      assert.equal(isFinancialIngestionContainmentActive(), row.expected);
    } finally {
      restoreEnv(previous);
    }
  });
}

test("legacy master flag blocks both split flags when active", () => {
  const previous = snapshotEnv();
  setEnv("1", "0", "0");
  try {
    assert.equal(isFinancialDataContainmentActive(), true);
    assert.equal(isFinancialReadContainmentActive(), true);
    assert.equal(isFinancialIngestionContainmentActive(), true);
  } finally {
    restoreEnv(previous);
  }
});

test("assertFinancialIngestionAllowed blocks when ingestion containment active", () => {
  const previous = snapshotEnv();
  setEnv("1");
  try {
    assert.throws(() => assertFinancialIngestionAllowed("org-a"), (err: unknown) => {
      assert.ok(err instanceof FinancialIngestionBlockedError);
      assert.equal(err.code, "FINANCIAL_INGESTION_CONTAINMENT");
      return true;
    });
  } finally {
    restoreEnv(previous);
  }
});

test("assertFinancialIngestionAllowed allows when ingestion containment disabled", () => {
  const previous = snapshotEnv();
  setEnv("0", "1", "0");
  try {
    assert.doesNotThrow(() => assertFinancialIngestionAllowed("org-a"));
  } finally {
    restoreEnv(previous);
  }
});

test("assertFinancialIngestionAllowed blocks when only ingestion flag active", () => {
  const previous = snapshotEnv();
  setEnv("0", "0", "1");
  try {
    assert.throws(() => assertFinancialIngestionAllowed("org-a"), FinancialIngestionBlockedError);
  } finally {
    restoreEnv(previous);
  }
});
