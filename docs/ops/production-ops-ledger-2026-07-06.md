# Production Operations Ledger — 2026-07-06

Record of production operations performed during the 22-commit sprint (`1620897` → `d42ff5c`).  
**Aggregate counts only. No PII. No tokens.**

Production HEAD kept at: `d42ff5c61eaf2676d9807fd6c9d712225884c467`

Pilot organization referenced: `cmpjd7j7e0001bl5tzv049rxb`

---

## 1. Gmail integration rebind

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-05 21:32 UTC (local backup timestamp); committed 2026-07-06 00:35 UTC+3 |
| **Script** | `node scripts/tenant-cleanup-backup.mjs` then `node scripts/tenant-cleanup-rebind-gmail.mjs` |
| **Data touched** | 1 `Integration` row (Gmail provider): `organizationId` moved from secondary org to canonical pilot org |
| **Backup** | `backend/backups/tenant-cleanup-2026-07-05T21-32-36-440Z/` (local, gitignored) |
| **Result** | Gmail account rebound to canonical org; refresh token and metadata preserved |
| **Rollback** | Restore from `full-backup.json` in backup dir; manual `integration.update` to prior `organizationId` |
| **Risk** | **High** — affects which org receives Gmail sync and invoice ingestion |

---

## 2. Render environment: security secrets

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-06 12:52 UTC+3 |
| **Script** | `node scripts/_tmp-p0-render-env-setup.mjs` (now archived) |
| **Data touched** | Render backend service env vars (not database) |
| **Variables added** | `SECRETS_ENCRYPTION_KEY`, `LEADS_WEBHOOK_SECRET` |
| **Backup** | N/A (Render env history via Render dashboard/API) |
| **Result** | Both variables confirmed present via Render API (length/format only logged) |
| **Rollback** | Restore prior env values in Render; may require re-encrypting stored tokens if encryption key rotated |
| **Risk** | **High** — required for commit `044376c` security deploy; wrong key breaks OAuth decrypt |

---

## 3. Render preDeploy command patch

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-06 09:55–10:31 UTC+3 |
| **Script** | `node scripts/_tmp-fix-render-predeploy.mjs` (archived); fix codified in commit `2ea8f1a` |
| **Data touched** | Render service `preDeployCommand` (Neon direct URL for Prisma migrate) |
| **Backup** | Prior command logged in script stdout (`before` JSON) |
| **Result** | Migrations deploy successfully on Render (pooler advisory-lock issue resolved) |
| **Rollback** | Revert `render.yaml` / Render service config to prior preDeploy |
| **Risk** | **Medium** — affects all future deploy migrations |

---

## 4. Migration: CommunicationEvent table

| Field | Detail |
|-------|--------|
| **Date/time** | Deploy of commit `9c956b6` (~2026-07-06 09:55 UTC+3) |
| **Command** | Render preDeploy: `npx prisma migrate deploy` |
| **Migration** | `20260706120000_add_communication_event` |
| **Data touched** | New `CommunicationEvent` table (schema add; no existing row mutation) |
| **Backup** | Neon/Render DB backups (provider-managed) |
| **Result** | Table created; Communication Core Phase 1 trace layer active |
| **Rollback** | Prisma down migration or manual table drop (would lose trace data) |
| **Risk** | **Low–Medium** — additive schema only |

---

## 5. Migration: WhatsApp inbound SID unique constraint

| Field | Detail |
|-------|--------|
| **Date/time** | Deploy of commit `5f797bd` (~2026-07-06 14:09 UTC+3) |
| **Command** | Render preDeploy: `npx prisma migrate deploy` |
| **Migration** | `20260706120000_whatsapp_inbound_sid_unique` |
| **Data touched** | Unique index on inbound `WhatsAppLog.providerMessageSid` (duplicate groups at time of audit: **0**) |
| **Backup** | `backend/data/p0-integrity-backup/2026-07-06T11-15-57-604Z/` (local export, gitignored) |
| **Result** | Constraint applied; duplicate inbound SIDs blocked on insert |
| **Rollback** | Drop unique index; duplicates could reappear |
| **Risk** | **Medium** — prevents duplicate webhook ingestion |

---

## 6. P0 pilot data integrity repair

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-06 14:15 UTC (after deploy `5f797bd`; user-approved) |
| **Script** | `node scripts/p0-data-integrity-backup.mjs` then `node scripts/p0-data-integrity-repair.mjs --execute` (scope=pilot default) |
| **Data touched** | Pilot org: `GmailScanItem`, `EmailMessage`, `FinancialDocumentReview`, `SupplierPayment`, `GlobalSupplierInvoice` |
| **Backup** | `backend/data/p0-integrity-backup/2026-07-06T11-07-40-928Z/` (pre-commit dry-run) and `2026-07-06T11-15-57-604Z/` (pre-repair) |
| **Result (aggregates)** | Cross-org GSI quarantined: **167**; FDR quarantined/aligned: **181**; zero-amount payments quarantined: **44**; payments flagged: **76**; FDR approved: **2**; invalid payment detach: **2**; GSI approved-without-payment fix: **1**. Post-repair: FDR mismatch **0**, GSI approved-no-payment **0** |
| **Rollback** | Restore from ID exports in backup dirs; no automated rollback script |
| **Risk** | **High** — intentional data remediation; global scope **not** run |

---

## 7. Test / validation webhooks (WhatsApp)

| Field | Detail |
|-------|--------|
| **Date/time** | Multiple runs 2026-07-06 during deploy validations |
| **Scripts** | `_tmp-comm-phase1-verify.mjs`, `_tmp-p0-deploy-validate.mjs`, `_tmp-preview-fix-prod-verify.mjs` (all archived) |
| **Command pattern** | Signed `POST` to `/webhook/whatsapp` with synthetic `MessageSid` prefix `MMpreview…` |
| **Data touched** | New `WhatsAppLog` rows; possible `FinancialDocumentReview` rows via ingestion pipeline; `CommunicationEvent` traces |
| **Backup** | N/A (test rows identifiable by synthetic SID / timestamp) |
| **Result** | Validations passed; payment gating confirmed on `needs_review` path |
| **Rollback** | Manual delete of test rows if needed (by synthetic SID); not automated |
| **Risk** | **Low–Medium** — creates real ingestion artifacts; no payment approval |

---

## 8. Preview verification (commit `d42ff5c`)

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-06 14:31+ UTC+3 |
| **Script** | `_tmp-preview-fix-prod-verify.mjs` (archived) |
| **Data touched** | One WhatsApp ingestion replay updated target review with Drive preview URL; legacy null-preview rows unchanged (**6** reported unchanged) |
| **Backup** | N/A |
| **Result** | Health commit matches `d42ff5c`; new ingestions get `driveFileUrl`; no backfill run |
| **Rollback** | Revert deploy to `5f797bd`; preview URLs on new rows only |
| **Risk** | **Low** — verification + forward fix only |

---

## 9. Temporary RBAC verification users

| Field | Detail |
|-------|--------|
| **Date/time** | ~2026-07-06 13:00–13:30 UTC+3 |
| **Script** | `_tmp-domain1-rbac-final.mjs`, `_tmp-whatsapp-rbac-probe.mjs` (archived) |
| **Data touched** | Temporary `User` + `OrganizationMember` (`read_only`) created and **deleted** in pilot org |
| **Backup** | N/A |
| **Result** | RBAC checks passed; member count before/after matched; temp email domain `@temp-verify.invalid` |
| **Rollback** | N/A — cleanup performed in-script |
| **Risk** | **Low** — ephemeral test principals |

---

## 10. Read-only production audits (no mutation)

| Operation | Script(s) | When |
|-----------|-----------|------|
| Domain 2 integrity snapshot | `_tmp-domain2-prod-snapshot.mjs`, `_tmp-domain2-pilot-extra.mjs` | 2026-07-06 |
| Lead count investigation | `_tmp-investigate-leads-count.mjs`, `_tmp-lead-count-before-after.mjs` | 2026-07-06 |
| Deploy polling / logs | `_tmp-poll-render-deploy.mjs`, `_tmp-render-deploy-logs.mjs` | 2026-07-05–06 |
| P0 supplemental checks | `_tmp-p0-supplement-check.mjs`, `_tmp-p0-logs-debug-check.mjs` | 2026-07-06 |
| Tenant verify | `tenant-cleanup-verify.mjs` | 2026-07-06 |

---

## Scripts with write capability — NOT executed

These were present locally but **no execution evidence** in the ops trail:

- `_tmp-reject-fp-payments.mjs` (payment reject by fingerprint)
- `_tmp-fix-blocked-rows.mjs` (FDR row fix)
- `_tmp-fix-blocked-invoices.mjs` (blocked invoice fix)

Archived under `backend/scripts/ops/archive/2026-07-06-tmp-audit/`.

---

## Related documentation

- 22-commit audit summary: agent session 2026-07-06
- Ops script rules: `backend/scripts/ops/README.md`
- Archive inventory: `backend/scripts/ops/archive/2026-07-06-tmp-audit/README.md`
