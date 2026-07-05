# Customer Journey Reliability Framework (Phase 2.0 design)

End-to-end workflow validation for Natalie. Golden Tests validate individual components; this framework validates complete customer journeys from start to finish.

```txt
customer-journey-tests/
  README.md
  journeys/
    financial-documents/
    manual-upload/
    calendar/
    tasks/
    payments/
    whatsapp/              # design only
  fixtures/
  expected/
    baselines/
    example-journey-report.json
  reports/                 # gitignored CI output
```

## Backend scaffold

| Module | Role |
|--------|------|
| `journeyTypes.ts` | `journey-reliability-v1` schema |
| `journeyRegistry.ts` | Canonical journey catalog (9 journeys) |
| `journeyValidation.ts` | Schema validation |
| `journeyAssertions.ts` | Journey-level assertion engine |
| `journeyFailureInjection.ts` | Synthetic failure simulation |
| `journeyValidationEngine.ts` | Outcome comparison + reliability score |
| `journeyRegression.ts` | Release gate policy |
| `journeyReport.ts` | Report builder |
| `journeyRunner.ts` | Dry-run orchestrator (no DB) |
| `journeyReliabilityIntegration.ts` | Reliability Foundation + Golden Suite hooks |
| `journeyDesign.test.ts` | Scaffold unit tests |

Run tests: `npx tsx --test src/services/journeyReliability/journeyDesign.test.ts`

## Safety

- No production DB access
- No scanner / extraction / business logic changes
- WhatsApp journeys are design-only (`implemented: false`)
- Synthetic simulation until Phase 2.1 pipeline adapters

## Integration (future)

- Reliability Foundation → `mapJourneyResultsToReliabilityEvents()`
- Golden Test Suite → `bridgeGoldenSuiteToJourney()` + `goldenSuiteCaseId`
- Health Dashboard v2 → `journeyReliabilityHealthExtension()`
- AI Auditor / Data Integrity Watch → journey assertion failures
