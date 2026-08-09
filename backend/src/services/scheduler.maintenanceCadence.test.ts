import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "scheduler.ts"), "utf8");

const NEON_AUTOSUSPEND_MINUTES = 5;

test("maintenance tick cadence is 10 minutes (above Neon autosuspend idle window)", () => {
  assert.match(source, /export const SCHEDULER_MAINTENANCE_CRON = "\*\/10 \* \* \* \*"/);
  assert.match(source, /export const SCHEDULER_MAINTENANCE_INTERVAL_MINUTES = 10/);
  assert.ok(10 >= NEON_AUTOSUSPEND_MINUTES);
});

test("scheduler has no unconditional * * * * * or */5 DB cron polls", () => {
  assert.doesNotMatch(source, /cron\.schedule\("\* \* \* \* \*"/);
  assert.doesNotMatch(source, /cron\.schedule\("\*\/5 \* \* \* \*"/);
  assert.match(
    source,
    /cron\.schedule\(SCHEDULER_MAINTENANCE_CRON, \(\) => void this\.runMaintenanceTick\(\)/
  );
});

test("runMaintenanceTick still invokes all three former poll targets", () => {
  const tick = source.match(/async runMaintenanceTick\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(tick.length > 0, "runMaintenanceTick present");
  assert.match(tick, /timeoutStaleJobRuns\(\)/);
  assert.match(tick, /processDueReminderJobs\("scheduler"\)/);
  assert.match(tick, /markNoResponseDueAppointments\(\)/);
});

test("reminder and job eligibility rules are not inlined into scheduler cadence change", () => {
  assert.doesNotMatch(source, /appointmentReminderJob\.findMany/);
  assert.doesNotMatch(source, /jobRun\.updateMany/);
});
