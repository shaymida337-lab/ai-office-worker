# Production Operations Scripts

This directory holds approved operational tooling and archived one-off scripts from production investigations.

## Rules

1. **All production write scripts must default to dry-run.** Mutations require an explicit `--execute` flag (or equivalent).
2. **`--execute` is required for writes.** Without it, scripts must roll back or skip mutation paths.
3. **Every write script must create or reference a backup** before changing production data (local export path documented in output).
4. **Every write script must print aggregate counts before and after** (no row-level PII).
5. **No script may print tokens, invoice text, or full PII.** Use redacted metadata and ID-only exports.
6. **Any script touching payments, invoices, FDR, or Gmail requires explicit approval** before execution in production.
7. **Temporary scripts must live under `ops/archive/`, not directly under `scripts/`.** Do not add new `_tmp-*` files to `backend/scripts/`.

## Layout

| Path | Purpose |
|------|---------|
| `ops/README.md` | This file — safety rules |
| `ops/archive/<date>-<topic>/` | Quarantined one-off scripts from audits or incidents |

## Committed production scripts (outside archive)

These remain in `backend/scripts/` because they are part of the approved ops toolkit:

- `p0-data-integrity-backup.mjs` — read-only export
- `p0-data-integrity-repair.mjs` — dry-run by default; `--execute` + `--scope=pilot|global`
- `tenant-cleanup-backup.mjs` — read-only export
- `tenant-cleanup-rebind-gmail.mjs` — **write** (Gmail integration org rebind)
- `tenant-cleanup-verify.mjs` — read-only verification
- `junk-leads-cleanup-plan.mjs` — read-only plan

See `docs/ops/production-ops-ledger-2026-07-06.md` for what was run in production during the Jul 2026 sprint.

## Archive

Jul 6 2026 audit archive: `ops/archive/2026-07-06-tmp-audit/`

**Do not run archived scripts without explicit approval.**
