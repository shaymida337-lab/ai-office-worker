# Data Integrity Watch — Phase 2.3A (Production MVP)

Read-only integrity layer protecting the highest-value financial and isolation risks first.

## Implemented validators (8)

| # | Check ID | Category |
|---|----------|----------|
| 1 | `fin-payment-without-source` | Financial |
| 2 | `fin-payment-after-blocked` | Financial |
| 3 | `fin-duplicate-fingerprint` | Financial |
| 4 | `fin-zero-amount-forbidden` | Financial |
| 5 | `org-cross-org-reference` | Organization |
| 6 | `scan-stuck` | Scanner |
| 7 | `scan-orphan-gmail-message` | Scanner |
| 8 | `int-gmail-invalid` | Integration |

## API

`GET /api/integrity/watch` — manual, auth-scoped, read-only.

Response: `{ report, health, trustStatus, summary }`

## Phase 2.3B (deferred)

Remaining validators are registered as placeholders in `integrityRegistry.ts` (`PLACEHOLDER_INTEGRITY_CHECKS`). Scheduler and trend reporting are also deferred.

## Constraints

- No DB writes
- No scanner / payment / outcome engine changes
- No auto-repair
- Organization-scoped queries only
