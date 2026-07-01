# Data Integrity Watch — Phase 2.3B (Signal Quality)

Refines the 8 core validators from Phase 2.3A without adding new checks or changing scanner/payment logic.

## Severity framework

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Customer money at risk, cross-tenant financial leak, active wrong persistence |
| **IMPORTANT** | Potential production issue requiring investigation |
| **WARNING** | Unexpected but explainable; historical duplicate-rescan |
| **INFO** | Operational observation; test traffic, shared mailbox history |

## Signal refinements

### Orphan Gmail (`scan-orphan-gmail-message`)
- **IGNORED** (not emitted): grace period (24h), system/junk mail
- **INFO**: test senders, non-invoice processed mail
- **CRITICAL**: invoice-like subject past grace without GSI/FDR

### Payment after BLOCKED (`fin-payment-after-blocked`)
- **CRITICAL**: `payment.createdAt > blockedFdr.createdAt` (active persistence)
- **WARNING**: payment predates blocked review (`duplicate_rescan`)

### Cross-org (`org-cross-org-reference`)
- **CRITICAL**: payment references foreign `emailMessageId`
- **INFO/WARNING**: shared mailbox history with `sharedGmailIdCount` + `affectedOrganizations`

## New report fields

- `findingConfidence` (0.0–1.0) on each finding
- `noiseAnalytics` — ignored counts, false-positive candidates, top noisy validators
- `signalQualityComparison` — before/after vs Phase 2.3A production baseline

## Production validation plan

1. Deploy to staging; run `GET /api/integrity/watch` for org `cmqxujfuj034ndy2czu9tjoko`
2. Expect critical drop from ~386 to &lt;20 (mostly invoice orphans + stuck scan if any)
3. Expect large `noiseAnalytics.ignoredCount` (~300+ junk/test/grace)
4. Verify `fin-payment-after-blocked` → WARNING with `duplicate_rescan`
5. Verify `org-cross-org-reference` → INFO with shared mailbox counts
6. Confirm scanner/payment endpoints unchanged

## Expected production impact (org cmqxujfuj034ndy2czu9tjoko)

| Metric | Before (2.3A) | Expected after (2.3B) |
|--------|--------------:|----------------------:|
| Critical | 386 | ~60 (invoice orphans) + 0–1 other |
| Warning | 0 | ~2 (blocked historical) |
| Info | 0 | ~245 (test) + ~71 (other) + 1 (shared mailbox) |
| Ignored | 0 | ~300+ (junk/grace/system) |

False positive rate for CRITICAL should fall well below 5%.
