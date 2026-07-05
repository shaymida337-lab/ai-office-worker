import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAvailabilitySlotFromUtterance } from "./availabilitySlotSelection.js";

const slots = [
  {
    startTime: "2026-07-06T07:00:00.000Z",
    endTime: "2026-07-06T08:00:00.000Z",
    label: "מחר 10:00",
    durationMinutes: 60,
  },
  {
    startTime: "2026-07-06T09:30:00.000Z",
    endTime: "2026-07-06T10:30:00.000Z",
    label: "מחר 12:30",
    durationMinutes: 60,
  },
  {
    startTime: "2026-07-06T13:00:00.000Z",
    endTime: "2026-07-06T14:00:00.000Z",
    label: "מחר 16:00",
    durationMinutes: 60,
  },
];

describe("availability slot selection", () => {
  it("resolves explicit HH:MM", () => {
    const result = resolveAvailabilitySlotFromUtterance("12:30", slots);
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") return;
    assert.equal(result.slot.label, "מחר 12:30");
    assert.equal(result.confidence, "high");
  });

  it("resolves Hebrew hour phrases", () => {
    const ten = resolveAvailabilitySlotFromUtterance("עשר", slots);
    assert.equal(ten.kind, "resolved");
    if (ten.kind !== "resolved") return;
    assert.equal(ten.slot.label, "מחר 10:00");

    const half = resolveAvailabilitySlotFromUtterance("בשתים עשרה וחצי", slots);
    assert.equal(half.kind, "resolved");
    if (half.kind !== "resolved") return;
    assert.equal(half.slot.label, "מחר 12:30");
  });

  it("resolves ordinal and relative picks", () => {
    const first = resolveAvailabilitySlotFromUtterance("הראשון", slots);
    assert.equal(first.kind, "resolved");
    if (first.kind !== "resolved") return;
    assert.equal(first.slot.label, "מחר 10:00");

    const second = resolveAvailabilitySlotFromUtterance("השני", slots);
    assert.equal(second.kind, "resolved");
    if (second.kind !== "resolved") return;
    assert.equal(second.slot.label, "מחר 12:30");

    const last = resolveAvailabilitySlotFromUtterance("האחרון", slots);
    assert.equal(last.kind, "resolved");
    if (last.kind !== "resolved") return;
    assert.equal(last.slot.label, "מחר 16:00");

    const early = resolveAvailabilitySlotFromUtterance("המוקדם", slots);
    assert.equal(early.kind, "resolved");
    if (early.kind !== "resolved") return;
    assert.equal(early.slot.label, "מחר 10:00");

    const late = resolveAvailabilitySlotFromUtterance("המאוחר", slots);
    assert.equal(late.kind, "resolved");
    if (late.kind !== "resolved") return;
    assert.equal(late.slot.label, "מחר 16:00");
  });

  it("resolves colloquial four o'clock reference", () => {
    const result = resolveAvailabilitySlotFromUtterance("זה של ארבע", slots);
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") return;
    assert.equal(result.slot.label, "מחר 16:00");
  });

  it("returns ambiguous when multiple afternoon slots match a vague phrase", () => {
    const afternoonSlots = [
      slots[1]!,
      slots[2]!,
    ];
    const result = resolveAvailabilitySlotFromUtterance("אחר הצהריים", afternoonSlots);
    assert.equal(result.kind, "ambiguous");
    if (result.kind !== "ambiguous") return;
    assert.equal(result.candidates.length, 2);
  });

  it("returns none for unrelated utterances", () => {
    const result = resolveAvailabilitySlotFromUtterance("מה המצב היום", slots);
    assert.equal(result.kind, "none");
  });

  it("clarifies when time is not among offered slots", () => {
    const result = resolveAvailabilitySlotFromUtterance("בשלוש", slots);
    assert.equal(result.kind, "ambiguous");
    if (result.kind !== "ambiguous") return;
    assert.match(result.message, /לא מצאתי את השעה/);
  });
});
