# Calendar Engine — Phase 4.5 Staging UI E2E Checklist

## Prerequisites

1. Phase 1 migration applied on local/staging DB.
2. Backend flags ON (see `backend/.env.e2e.example`) — **never in production**.
3. Frontend flags ON (see `frontend/.env.e2e.example`) — **never in production**.
4. Restart both servers after changing flags.

## Automated E2E (mocked — no DB required)

```bash
cd frontend
npm install
npx playwright install chromium
npm run test:e2e:engine-on    # flags ON: dev server on :3100 (11 tests)
npm run test:e2e:engine-off   # flags OFF: production build on :3200 (2 tests)
npm run test:e2e              # both suites sequentially (~90s)
```

**Windows notes:** E2E uses dedicated ports `3100` (engine ON) and `3200` (engine OFF). If tests fail with `ECONNREFUSED`, kill stale Node processes on those ports before re-running. Optional: `E2E_SKIP_WEBSERVER=1` with a manually started dev server on `:3100`.

**Last verified (local):** 11/11 Playwright engine-on + 2/2 engine-off; 60 frontend unit; 106 backend calendar/appointment tests.

Covers:
- Calendar page loads engine path
- Owner Decision Queue panel
- Create draft → submit → pending → approve → confirmed
- Work Case timeline in drawer
- Reject decision flow
- Flags OFF → `/api/appointments`
- Engine 503 → Hebrew banner + appointments fallback (no crash)

## Integration E2E (real backend + DB)

```bash
# Terminal 1 — backend with flags ON
cd backend && npx tsx scripts/calendar-engine-e2e-fixtures.ts   # copy E2E_TOKEN

# Terminal 2 — backend
cd backend && npm run dev

# Terminal 3 — frontend with flags ON
cd frontend && npm run dev

# Terminal 4 — integration test
cd frontend
E2E_INTEGRATION=1 E2E_TOKEN=<token> E2E_SKIP_WEBSERVER=1 npm run test:e2e:integration
```

## Manual staging smoke (flags ON)

1. Open `/dashboard/calendar` — **תור החלטות** visible.
2. **תור חדש** → submit → **ממתין לאישורך** (not **נקבע**).
3. Pending badge in queue → **אשר** → event **מאושר**.
4. Click event → drawer shows **ציר זמן תיק**.
5. Repeat with **דחה** — queue clears, event cancelled.
6. Backend smoke: `cd backend && npx tsx scripts/calendar-engine-runtime-smoke.ts`

## Phase 11.5 — Org-level pilot runtime (local/staging only)

### Migrations

```bash
cd backend
npx tsx scripts/apply-calendar-phase1-local.ts      # if Phase 1 tables missing
npx tsx scripts/apply-calendar-org-flags-local.ts   # Phase 11 org flag columns
npx tsx scripts/verify-calendar-migration.ts
```

### Enable pilot org (one org only)

```bash
cd backend
CALENDAR_ENGINE_V1_READ=true CALENDAR_ENGINE_V1_WRITE=true \
CALENDAR_ENGINE_PILOT_ADMIN=true \
npx tsx scripts/calendar-engine-pilot-org.ts enable --org-id <orgId> [--google-mirror] [--notes "wave 1"]
```

Frontend (local/staging): set `NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ=true` and `NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE=true`, restart dev server.

### Automated pilot runtime smoke

```bash
cd backend
CALENDAR_ENGINE_V1_READ=true CALENDAR_ENGINE_V1_WRITE=true \
npx tsx scripts/calendar-engine-pilot-runtime-smoke.ts
```

Covers: capabilities (pilot vs non-pilot), unified availability conflict, Natalie engine book, briefing + deep link, approve + timeline, org-disabled fallback.

### Manual UI checks (pilot org)

1. `/dashboard/calendar` — capabilities ON → Owner Decision Queue visible.
2. `/dashboard` — briefing shows pending engine decisions.
3. Click decision CTA → `/dashboard/calendar?decisionId=...` highlights queue item.
4. Disable org flags → calendar falls back to `/api/appointments`.

## Flags OFF verification

1. Set all four flags to `false`, restart servers.
2. Queue panel hidden; calendar uses appointments.
3. `npm run test:e2e:engine-off` passes.

## Unit / regression

```bash
cd frontend && npx tsx --test src/lib/**/*.test.ts
cd backend && npx tsx --test src/routes/calendarEngineRoutes.test.ts src/services/calendar/*.test.ts src/services/appointmentService.test.ts
```

## Production safety

- `render.yaml` production services do **not** set calendar engine flags.
- Production frontend does **not** set `NEXT_PUBLIC_CALENDAR_ENGINE_*`.

## Phase 7 — Complete / no-show (staging only)

1. Enable engine flags in staging/local.
2. Create and approve a confirmed event whose start time is in the past.
3. Open event drawer → **סמן כהושלם** / **הלקוח לא הגיע** visible (not before start).
4. Complete: notes + outcome required → status **הושלם**; timeline **event_completed**; no invoice row.
5. No-show: reason required → status **לא הגיע**; timeline **event_no_show**; no invoice placeholder.
6. With `autoCreateFollowUpTask=true`: complete spawns follow-up task + **task_spawned** timeline entry.
7. Google mirrored event remains unchanged on complete (no delete).

**Automated E2E:**

```bash
cd frontend && npm run test:e2e:engine-on   # includes complete/no-show specs
```

**Backend completion tests:**

```bash
cd backend && npx tsx --test src/services/calendar/calendarEngineServices.test.ts
```

## Phase 6 — Cancel / reschedule (staging only)

1. Enable engine flags in staging/local.
2. Create and approve a confirmed event.
3. Open event drawer → **ביטול תור** → verify queue shows cancel card with **ממתין לאישורך**; event still **מאושר**.
4. Approve cancel → event **בוטל**; timeline shows **event_cancelled**.
5. Repeat with **דחיית תור** → submit new date/time → approve → old event **נדחה**, new event **ממתין לבדיקה**.
6. Reject a cancel/reschedule request → event stays **מאושר**.
7. With Google connected: approve cancel/reschedule and verify mirror delete (Phase 5).

**Automated E2E:**

```bash
cd frontend && npm run test:e2e:engine-on   # includes cancel/reschedule specs
```

**Backend decision tests:**

```bash
cd backend && npx tsx --test src/services/calendar/calendarEngineServices.test.ts
```

## Phase 5 — Google Calendar mirror (staging only)

**Prerequisites:** Google Calendar connected via `/integrations/calendar/connect`.

1. Enable engine flags in staging/local only (see `.env.e2e.example`).
2. Create draft event → submit for confirmation → approve decision.
3. Confirm Natalie event status is **מאושר** (confirmed).
4. Confirm Google Calendar shows event titled `{client} — {service or תור}` with description **נוצר על ידי נטלי** only.
5. Confirm Work Case timeline shows **google_sync_success** (or **google_sync_failed** if Google unreachable — Natalie state must remain confirmed).
6. Reschedule/cancel via approved decision → Google event removed/updated.
7. Re-approve same decision → no duplicate Google event.
8. With Google disconnected → `googleSyncStatus=skipped`, no crash.

**Automated mirror tests:**

```bash
cd backend
npx tsx --test src/services/calendar/calendarGoogleMirrorPayload.test.ts src/services/calendar/calendarGoogleMirrorService.test.ts
```
