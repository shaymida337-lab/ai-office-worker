# Invoice Golden Dataset (phase 1 — 20 fixtures)

Offline regression corpus for invoice extraction + completeness routing.

## Layout

```txt
golden/
  README.md
  manifest.json
  files/                 # synthetic text stand-ins for PDF/OCR/email bodies
```

Files are **synthetic only**. No real customer PII, bank details, phones, emails, or live invoice numbers.

`.txt` files represent the text layer that production deterministic extractors already consume (`extractDeterministicInvoiceFieldsFromPdfText`). Binary PDFs/images are intentionally deferred; `sourceType` still labels the intended channel.

## Runner

From `backend/`:

```bash
npx tsx scripts/run-invoice-golden.ts
# or as a node:test suite:
npx tsx --test src/services/invoice/invoiceGoldenRunner.test.ts
```

The runner:

1. Loads each fixture text
2. Runs **production** deterministic PDF-text extraction
3. Applies fixture `routingHints` only for post-extraction signals (camera / duplicate gate) — same shapes production already persists
4. Routes with **production** `assessInvoiceCompleteness` + `isConfidentlyNotFinancialDocument`
5. Compares to `expected` without mutating the engine

Baseline failures are expected: document them; do not weaken expected or patch extractors to green the suite.

## Safety

- No DB
- No Claude / OCR APIs
- No Gmail live scan
- No production routing/OCR prompt edits from this folder
