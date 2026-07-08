import test from "node:test";
import assert from "node:assert/strict";

import {
  isBestAvailablePhrase,
  parseSlotTimeConstraints,
  rankAvailableSlots,
  slotMatchesConstraints,
  buildSlotRankingOptions,
} from "./slotRanking.js";
import type { SlotCandidate } from "./types.js";

const RULES = {
  timeZone: "UTC",
  workingStartHour: 7,
  workingEndHour: 21,
};

function slot(iso: string): SlotCandidate {
  const start = new Date(iso);
  return { start, end: new Date(start.getTime() + 30 * 60_000), durationMinutes: 30 };
}

test("parseSlotTimeConstraints detects morning and after-16 constraints", () => {
  assert.deepEqual(parseSlotTimeConstraints("יש לי שעה פנויה מחר בבוקר?"), [{ kind: "morning" }]);
  assert.deepEqual(parseSlotTimeConstraints("יש לי שעה פנויה אחרי 16:00?"), [
    { kind: "after", hour: 16, minute: 0 },
  ]);
  assert.deepEqual(parseSlotTimeConstraints("לפני 12:00"), [{ kind: "before", hour: 12, minute: 0 }]);
});

test("isBestAvailablePhrase detects ranked booking phrases", () => {
  assert.equal(isBestAvailablePhrase("תקבעי לי פגישה עם רון בזמן הכי טוב מחר"), true);
  assert.equal(isBestAvailablePhrase("מתי הכי כדאי לקבוע מחר?"), true);
  assert.equal(isBestAvailablePhrase("תמצאי לי שעה טובה מחר"), true);
});

test("rankAvailableSlots prefers 10:30 over 07:00 on a free day", () => {
  const candidates = [
    slot("2026-06-20T07:00:00.000Z"),
    slot("2026-06-20T07:30:00.000Z"),
    slot("2026-06-20T09:00:00.000Z"),
    slot("2026-06-20T10:30:00.000Z"),
    slot("2026-06-20T11:00:00.000Z"),
  ];
  const ranked = rankAvailableSlots(candidates, buildSlotRankingOptions(RULES), 3);
  assert.deepEqual(
    ranked.map((item) => item.start.toISOString()),
    [
      "2026-06-20T10:30:00.000Z",
      "2026-06-20T11:00:00.000Z",
      "2026-06-20T09:00:00.000Z",
    ]
  );
});

test("slotMatchesConstraints filters morning slots only", () => {
  const morning = slot("2026-06-20T09:00:00.000Z");
  const evening = slot("2026-06-20T18:00:00.000Z");
  const constraints = [{ kind: "morning" as const }];
  assert.equal(slotMatchesConstraints(morning, constraints, "UTC", RULES), true);
  assert.equal(slotMatchesConstraints(evening, constraints, "UTC", RULES), false);
});

test("rankAvailableSlots with after-16 constraint returns only late slots", () => {
  const candidates = [
    slot("2026-06-20T09:00:00.000Z"),
    slot("2026-06-20T16:00:00.000Z"),
    slot("2026-06-20T17:00:00.000Z"),
    slot("2026-06-20T22:00:00.000Z"),
  ];
  const ranked = rankAvailableSlots(
    candidates,
    buildSlotRankingOptions(RULES, { constraints: [{ kind: "after", hour: 16, minute: 0 }] }),
    3
  );
  assert.deepEqual(
    ranked.map((item) => item.start.toISOString()),
    ["2026-06-20T16:00:00.000Z", "2026-06-20T17:00:00.000Z"]
  );
});

test("rankAvailableSlots never returns slots outside working hours", () => {
  const candidates = [
    slot("2026-06-20T06:30:00.000Z"),
    slot("2026-06-20T21:00:00.000Z"),
    slot("2026-06-20T10:00:00.000Z"),
  ];
  const ranked = rankAvailableSlots(candidates, buildSlotRankingOptions(RULES), 3);
  assert.deepEqual(ranked.map((item) => item.start.toISOString()), ["2026-06-20T10:00:00.000Z"]);
});
