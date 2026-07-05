# Home Dashboard V2 — Phase 0 Baseline

**Tag:** `home-v2-baseline`  
**Commit:** `c4ab996` — `fix(dashboard): unify sync state presentation`  
**Captured:** 2026-07-03 (UTC+3)

## Purpose

Frozen pre-refactor baseline before Phase 1 ViewModel/hook extraction. Used for regression comparison, rollback reference, and visual diff.

## Build status

| Check | Result |
|-------|--------|
| `npm run build` (frontend) | **PASS** (exit 0) |
| Artifact | `build-output.txt` |

## Test status

| Suite | Result |
|-------|--------|
| `dashboardSyncRegression.test.ts` | **27/27 PASS** |
| `dashboardSyncState.test.ts` | included above |
| Full dashboard lib tests (`src/lib/dashboard/*.test.ts`) | **57/63 PASS**, 6 pre-existing failures (see below) |

### Pre-existing failures (baseline, not introduced by Phase 1)

1. `home.test.ts` — `buildHeroHumanMessage` first-visit copy mismatch  
2. `scanStatusTruth.test.ts` — `resolveConfirmedSyncIssue` expectation  
3. `smartSuggestions.test.ts` — 4 failures (connect/scan chip logic)

Artifact: `test-output.txt`

## Screenshots

| Viewport | Status |
|----------|--------|
| 390px | Referenced in `frontend/_visual-qa/` (when present) |
| 430px | **Not captured** — requires authenticated Playwright session |
| 768px | **Not captured** |
| 1366px | **Not captured** |
| 1920px | **Not captured** |

> Full multi-breakpoint capture requires a running dev server + logged-in session. Phase 0 documents build/test baseline; remaining viewports should be captured before Phase 2 UI work.

## Rollback

```bash
git checkout home-v2-baseline -- frontend/src/app/dashboard/page.tsx
# Remove Phase 1 files if reverting extraction:
# frontend/src/hooks/useDashboardHome.ts
# frontend/src/lib/dashboard/buildDashboardHomeViewModel.ts
# frontend/src/lib/dashboard/homePage{Types,Constants,Helpers}.ts
```

## Phase 1 post-check

After ViewModel extraction, compare:

- Build output (must pass)
- Regression tests (must pass)
- JSX in `page.tsx` (must be structurally identical; only `d.*` hook bindings)
- `/dashboard` bundle size (should be within ~1–2% of baseline)
