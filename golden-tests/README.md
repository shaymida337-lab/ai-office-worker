# Golden Test Suite — Dataset Layout (Phase 1.9 design)

Proposed repository layout for Natalie golden regression tests.
Synthetic fixtures only in git; real business documents stay out of version control.

```txt
golden-tests/
  README.md
  cases/
    invoices/
    receipts/
    supplier-payments/
    non-financial/
    duplicates/
    edge-cases/
  fixtures/
    pdf/                  # gitignored — local/staging only
    images/               # gitignored
    email-metadata/       # anonymized JSON (safe to commit)
    whatsapp-metadata/
  expected/
    baselines/
    expected-results.json
  reports/                # gitignored CI output
```

## Phase rollout

| Phase | Target | Composition |
|-------|--------|-------------|
| A | 65 | 25 invoices, 10 receipts, 10 non-financial, 10 duplicates, 5 bad images, 5 Hebrew edge |
| B | 100–200 | More channels and outcome buckets |
| C | 500–1,000 | Pre-broad-launch gate |

## Safety

- No production DB access from the golden runner.
- No real customer files in git.
- Anonymize before staging; use `goldenSanitizer.ts` patterns.

## Backend scaffold (Phase 1.9)

| Module | Role |
|--------|------|
| `backend/src/services/golden/goldenSuiteTypes.ts` | `golden-suite-v1` case schema |
| `goldenSuiteValidation.ts` | Schema validation |
| `goldenSuiteComparison.ts` | Strict vs tolerance field comparison |
| `goldenSuiteRegression.ts` | Release gate policy |
| `goldenSuiteReport.ts` | Regression report builder |
| `goldenSuiteRunner.ts` | Dry-run orchestrator (no DB) |
| `goldenSuiteReliability.ts` | Reliability event + dashboard hooks |
| `goldenSuiteDesign.test.ts` | Scaffold unit tests |

Example fixtures: `backend/src/services/golden/fixtures/golden-suite/`
Example report: `golden-tests/expected/example-regression-report.json`

Run tests: `npx tsx --test src/services/golden/goldenSuiteDesign.test.ts`
