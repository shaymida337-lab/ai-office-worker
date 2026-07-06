# Archived temporary scripts — 2026-07-06 audit

Quarantined from `backend/scripts/` after the 22-commit sprint audit.  
**Do not run without explicit approval.**

These files were **never committed** to `origin/main` in their original location. They are preserved for forensics and rollback reference only.

---

## Inventory

| Filename | Purpose | Write-capable | Executed | Risk area |
|----------|---------|---------------|----------|-----------|
| `_tmp-check-natalie-session-migration.mjs` | Check Natalie session migration status on prod DB | No (read) | No evidence | DB |
| `_tmp-comm-phase1-verify.mjs` | Send signed WhatsApp webhook; verify `CommunicationEvent` + API | Yes (webhook → app writes) | **Yes** | WhatsApp, DB, security |
| `_tmp-dep-health.mjs` | Poll deploy/health endpoints | No | No evidence | infra |
| `_tmp-deploy-lead-quality-verify.mjs` | Post-deploy lead-quality validation | No (API read) | **Yes** | CRM |
| `_tmp-domain1-rbac-final.mjs` | Create temp `read_only` user, RBAC probes, delete user | **Yes** (User/Member create+delete) | **Yes** | security, DB |
| `_tmp-domain2-pilot-extra.mjs` | Pilot org integrity aggregate SQL snapshot | No (read) | **Yes** | payments, invoices, DB |
| `_tmp-domain2-prod-snapshot.mjs` | Global/pilot integrity aggregates, no PII | No (read) | **Yes** | payments, invoices, DB |
| `_tmp-find-bad-supplier.mjs` | Investigate supplier payment anomalies | No (read) | No evidence | payments |
| `_tmp-fix-blocked-invoices.mjs` | Fix blocked FDR rows by ID | **Yes** (`--execute`) | **No** | invoices, FDR, payments |
| `_tmp-fix-blocked-rows.mjs` | Fix blocked review rows by ID | **Yes** (`--execute`) | **No** | invoices, FDR |
| `_tmp-fix-render-predeploy.mjs` | Patch Render `preDeployCommand` for Neon migrate | **Yes** (Render API) | **Yes** | infra, DB |
| `_tmp-golden-debug.mjs` | Run local golden dataset cases (no prod DB) | No | No evidence | tests |
| `_tmp-investigate-leads-count.mjs` | Production lead count breakdown | No (read) | **Yes** | CRM, DB |
| `_tmp-journey-check.mjs` | Local journey reliability dry-run | No | No evidence | tests |
| `_tmp-lead-count-before-after.mjs` | Compare lead counts before/after junk filter | No (read) | **Yes** | CRM, DB |
| `_tmp-local-prod-checks.mjs` | Miscellaneous local prod connectivity checks | No | No evidence | infra |
| `_tmp-monitor-manual.ts` | Manual prod DB monitoring helper | Unknown (review before use) | No evidence | DB |
| `_tmp-natalie-prod-verify.mjs` | Natalie production API verification | No (API read) | No evidence | WhatsApp |
| `_tmp-p0-deploy-validate.mjs` | Full P0 security deploy validation suite | Yes (webhooks + API probes) | **Yes** | security, WhatsApp |
| `_tmp-p0-logs-debug-check.mjs` | Scan Render logs for sensitive patterns | No | **Yes** | security |
| `_tmp-p0-pilot-deploy-validate.mjs` | Post-repair pilot P0 validation aggregates | No (read + API) | **Yes** | payments, invoices, DB |
| `_tmp-p0-render-env-setup.mjs` | Generate and set Render security env vars | **Yes** (Render API) | **Yes** | security |
| `_tmp-p0-supplement-check.mjs` | Supplemental debug/tenant isolation checks | No | **Yes** | security |
| `_tmp-poll-render-deploy.mjs` | Poll Render deploy until LIVE/FAILED | No | **Yes** | infra |
| `_tmp-preview-api-check.mjs` | Check FDR preview via API for one review ID | No (read) | No evidence | invoices, UI |
| `_tmp-preview-fix-prod-verify.mjs` | Verify unified preview fix on production | Yes (signed WhatsApp webhook) | **Yes** | invoices, WhatsApp, FDR |
| `_tmp-preview-query.mjs` | Query FDR preview fields | No (read) | **Yes** | invoices, FDR |
| `_tmp-preview-query2.mjs` | Query recent FDR updates after preview deploy | No (read) | **Yes** | invoices, FDR |
| `_tmp-prod-final-validate.mjs` | Final production validation checks | No | No evidence | infra |
| `_tmp-query-fp-links.mjs` | Query payment fingerprint links | No (read) | No evidence | payments |
| `_tmp-query-reviews.mjs` | Query financial document reviews | No (read) | No evidence | invoices, FDR |
| `_tmp-reject-fp-payments.mjs` | Reject payments by document fingerprint | **Yes** (`--execute`) | **No** | payments |
| `_tmp-render-deploy-logs.mjs` | Fetch Render deploy events/logs | No | **Yes** | infra |
| `_tmp-sync-render-predeploy.mjs` | Sync/compare Render preDeploy with repo | Possibly (Render API) | No evidence | infra, DB |
| `_tmp-verify-stt-prod-vocab.mjs` | Verify STT vocabulary on production | No (API) | No evidence | scripts |
| `_tmp-verify-voice-turn-prod.mjs` | Verify voice turn on production | No (API) | No evidence | scripts |
| `_tmp-whatsapp-rbac-probe.mjs` | Probe WhatsApp endpoints as `read_only` | No (API) | **Yes** | security, WhatsApp |

---

## Scripts removed before archive (not present here)

| Filename | Notes |
|----------|-------|
| `_tmp-query.mjs` | Ran once for FDR query; deleted after use |
| `_tmp-whatsapp-mapping-check.ts` | Ran once for WA mapping; deleted after use |

---

## Warning

**Do not run without explicit approval.**

Especially dangerous if run with `--execute` or against production credentials:

- `_tmp-reject-fp-payments.mjs`
- `_tmp-fix-blocked-rows.mjs`
- `_tmp-fix-blocked-invoices.mjs`
- `_tmp-p0-render-env-setup.mjs`
- `_tmp-fix-render-predeploy.mjs`
- `_tmp-domain1-rbac-final.mjs`
- Any script that sends signed WhatsApp webhooks to production

For approved production operations, use the committed scripts documented in `backend/scripts/ops/README.md` and `docs/ops/production-ops-ledger-2026-07-06.md`.
