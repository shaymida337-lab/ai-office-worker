import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBookAppointmentActionFeedback } from "./natalieBookFeedback";

describe("buildBookAppointmentActionFeedback", () => {
  it("pendingApproval=true never claims the appointment was booked", () => {
    const feedback = buildBookAppointmentActionFeedback({
      clientName: "שרית",
      whenLabel: "מחר ב-15:00",
      pendingApproval: true,
      message: "שלחתי את הבקשה לאישור — התור ממתין לאישורך לפני שייקבע.",
    });
    assert.match(feedback, /אישור/);
    assert.equal(feedback.includes("התור נקבע"), false);
  });

  it("pendingApproval=true falls back to שלחתי לאישור when API message missing", () => {
    const feedback = buildBookAppointmentActionFeedback({
      clientName: "שרית",
      whenLabel: "מחר ב-15:00",
      pendingApproval: true,
    });
    assert.match(feedback, /שלחתי לאישור/);
    assert.equal(feedback.includes("התור נקבע"), false);
  });

  it("confirmed appointment shows התור נקבע", () => {
    const feedback = buildBookAppointmentActionFeedback({
      clientName: "שרית",
      whenLabel: "מחר ב-15:00",
      pendingApproval: false,
    });
    assert.match(feedback, /התור נקבע/);
  });

  it("confirmed prefers API message when provided", () => {
    const feedback = buildBookAppointmentActionFeedback({
      clientName: "שרית",
      whenLabel: "מחר ב-15:00",
      pendingApproval: false,
      message: "התור אושר ונקבע.",
    });
    assert.equal(feedback, "התור אושר ונקבע.");
  });
});
