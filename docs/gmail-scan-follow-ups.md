# Gmail scan follow-ups

Tracked items separate from shipped deliveries. Do not conflate with in-flight delivery work.

## Delivery 1 — complete

**Shipped:** `8d01406` — `fix(gmail): pause long scans at deadline with honest backlog lifecycle`

**Scope delivered:**

- `paused` terminal status and cooperative deadline checks in the Gmail sync worker
- Honest backlog semantics (`windowTruncated`, cursor excludes `paused` / `stale` / truncated `completed`)
- Frontend banner, dashboard, and Natalie backlog awareness
- Structured `[gmail-scan-lifecycle]` telemetry

**Status:** Deployed to production; baseline validation clean for laperla (`cmqxujfuj034ndy2czu9tjoko`).

**Not in scope:** Delivery 2 (campaign model, checkpoint JSON, page-token resume, streaming pipeline, auto-continuation).

---

## Orphan investigation — separate from Delivery 1

**Incident:** `SyncLog` `cmr0s3n0t0ag3lx1s2o2tgyfb` — `fast_recurring` on org קדמה (`cmpjd7j7e0001bl5tzv049rxb`).

**Outcome (production, read-only):** Row closed `stale` at 2026-06-30 16:26:38 UTC after ~81 minutes `running`. Next fast scan for that org completed normally at 16:26:47 UTC. **Not caused by Delivery 1.**

**Production action:** None required.

---

## Follow-up: Fast recurring scan orphan / global queue isolation

**Status:** Not started. Do not implement until explicitly approved (separate from Delivery 2).

**Problem summary:** A hung `fast_recurring` scan left a `running` `SyncLog` without worker finalization. While active, it blocked new fast scans for that org. Global `gmailScanQueue` serialization delayed read-side stale close (~81 min vs 30 min nominal).

**Scope for future investigation:**

| Area | Intent |
|------|--------|
| **fastOnly finalization guarantee** | Ensure every `fast_recurring` run terminalizes (`completed` / `failed` / `paused`) even on worker errors or hangs |
| **Proactive stale sweeper** | Periodic job to call `closeStaleGmailScansForOrg` for all orgs with active scans, independent of sync queue depth |
| **Per-org queue isolation** | Prevent one org’s hung scan from blocking all orgs on the global queue |
| **Alerting** | Alert on `running` gmail scans older than 35 minutes (e.g. via `[gmail-scan-lifecycle]` telemetry) |

**Reference orphan:** `cmr0s3n0t0ag3lx1s2o2tgyfb` (קדמה / `cmpjd7j7e0001bl5tzv049rxb`).

---

## Delivery 2 — not started

Campaign model, checkpoint JSON, page-token resume, streaming pipeline, auto-continuation. Awaiting explicit approval.
