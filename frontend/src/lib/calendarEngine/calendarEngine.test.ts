import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCalendarCreateStrategy,
  resolveCalendarLoadStrategy,
  submitConfirmationUserMessage,
} from "./api.js";
import { calendarEventToDisplayItem, durationMinutesFromRange } from "./adapters.js";
import { isCalendarEngineReadEnabled, isCalendarEngineWriteEnabled } from "./flags.js";
import {
  calendarEventStatusLabel,
  isPendingOwnerApproval,
  PENDING_OWNER_APPROVAL_LABEL,
} from "./statusLabels.js";
import type { CalendarEngineEvent } from "./types.js";

const sampleEvent: CalendarEngineEvent = {
  id: "evt-1",
  status: "pending_readiness",
  startAt: "2026-06-25T09:00:00.000Z",
  endAt: "2026-06-25T10:00:00.000Z",
  workCaseId: "wc-1",
  clientId: "client-1",
  client: { id: "client-1", name: "לקוח בדיקה" },
  service: { id: "svc-1", name: "ייעוץ", durationMinutes: 60 },
  prerequisitesJson: [{ id: "client", label: "אישור לקוח", required: true, passed: false }],
};

test("flags default OFF when env unset", () => {
  const prevRead = process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ;
  const prevWrite = process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE;
  delete process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ;
  delete process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE;
  assert.equal(isCalendarEngineReadEnabled(), false);
  assert.equal(isCalendarEngineWriteEnabled(), false);
  if (prevRead !== undefined) process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ = prevRead;
  if (prevWrite !== undefined) process.env.NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE = prevWrite;
});

test("load strategy uses appointments when read flag OFF", () => {
  assert.equal(resolveCalendarLoadStrategy(false), "appointments");
});

test("load strategy uses calendar engine when read flag ON", () => {
  assert.equal(resolveCalendarLoadStrategy(true), "calendar_engine");
});

test("create strategy uses appointment flow when write flag OFF", () => {
  assert.equal(resolveCalendarCreateStrategy(false), "appointment");
});

test("create strategy uses engine draft when write flag ON", () => {
  assert.equal(resolveCalendarCreateStrategy(true), "calendar_engine_draft");
});

test("calendar event adapter maps to timeline display shape", () => {
  const item = calendarEventToDisplayItem(sampleEvent);
  assert.equal(item.source, "calendar_engine");
  assert.equal(item.client.name, "לקוח בדיקה");
  assert.equal(item.durationMinutes, 60);
  assert.equal(item.startTime, sampleEvent.startAt);
  assert.equal(item.engineEventId, "evt-1");
});

test("durationMinutesFromRange computes from start/end", () => {
  assert.equal(durationMinutesFromRange("2026-06-25T09:00:00.000Z", "2026-06-25T09:45:00.000Z"), 45);
});

test("Hebrew status labels for engine statuses", () => {
  assert.equal(calendarEventStatusLabel("draft"), "טיוטה");
  assert.equal(calendarEventStatusLabel("pending_readiness"), "ממתין לבדיקה");
  assert.equal(calendarEventStatusLabel("confirmed"), "מאושר");
  assert.equal(calendarEventStatusLabel("completed"), "הושלם");
  assert.equal(calendarEventStatusLabel("cancelled"), "בוטל");
  assert.equal(calendarEventStatusLabel("no_show"), "לא הגיע");
  assert.equal(calendarEventStatusLabel("rescheduled"), "נדחה");
});

test("pending owner approval detection", () => {
  assert.equal(isPendingOwnerApproval("pending_readiness"), true);
  assert.equal(isPendingOwnerApproval("confirmed"), false);
  assert.equal(PENDING_OWNER_APPROVAL_LABEL, "ממתין לאישורך");
});

test("submit confirmation user message never claims scheduled before approval", () => {
  assert.equal(submitConfirmationUserMessage({ mode: "queued", decisionId: "d1", queueType: "confirm_appointment" }), "ממתין לאישורך");
  assert.equal(
    submitConfirmationUserMessage({
      mode: "confirmed",
      event: { ...sampleEvent, status: "confirmed" },
    }),
    "האירוע אושר"
  );
});

test("create draft + submit orchestration with injected deps", async () => {
  const calls: string[] = [];
  const draft = { ...sampleEvent, status: "draft" as const };
  const createDraft = async () => {
    calls.push("create");
    return draft;
  };
  const submit = async (id: string) => {
    calls.push(`submit:${id}`);
    return { mode: "queued" as const, decisionId: "dec-1", queueType: "confirm_appointment" };
  };

  const created = await createDraft();
  const result = await submit(created.id);
  assert.deepEqual(calls, ["create", "submit:evt-1"]);
  assert.equal(result.mode, "queued");
  assert.equal(submitConfirmationUserMessage(result), "ממתין לאישורך");
});
