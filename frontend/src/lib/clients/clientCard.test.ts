import test from "node:test";
import assert from "node:assert/strict";
import {
  clientInitials,
  displayOrFallback,
  displayPhone,
  formatAppointmentPrice,
  formatNextAppointment,
  mailtoHref,
  mapsHref,
  orderClientAppointmentsForTab,
  telHref,
  whatsappHref,
  NOT_PROVIDED,
} from "./clientCard";

test("שדות חסרים מוצגים 'לא הוזן' — אף פעם לא null/undefined", () => {
  assert.equal(displayOrFallback(null), NOT_PROVIDED);
  assert.equal(displayOrFallback(undefined), NOT_PROVIDED);
  assert.equal(displayOrFallback("   "), NOT_PROVIDED);
  assert.equal(displayOrFallback(" רות "), "רות");
});

test("ראשי תיבות: שם מלא, שם יחיד, וריק", () => {
  assert.equal(clientInitials("רות כהן"), "רכ");
  assert.equal(clientInitials("רות"), "רו");
  assert.equal(clientInitials("  "), "?");
});

test("תצוגת טלפון: קידומת whatsapp: מוסרת, ריק = 'לא הוזן'", () => {
  assert.equal(displayPhone("whatsapp:+972501234567"), "+972501234567");
  assert.equal(displayPhone("050-1234567"), "050-1234567");
  assert.equal(displayPhone(null), NOT_PROVIDED);
});

test("חיוג: מספר ישראלי מנורמל ל-E.164, קצר מדי נפסל", () => {
  assert.equal(telHref("050-123-4567"), "tel:+972501234567");
  assert.equal(telHref("+1 (415) 523-8886"), "tel:+14155238886");
  assert.equal(telHref("123"), null);
  assert.equal(telHref(null), null);
});

test("וואטסאפ: המרה לפורמט בינלאומי בלי + ובלי אפס מוביל", () => {
  assert.equal(whatsappHref("050-1234567"), "https://wa.me/972501234567");
  assert.equal(whatsappHref("+972501234567"), "https://wa.me/972501234567");
  assert.equal(whatsappHref("972501234567"), "https://wa.me/972501234567");
  assert.equal(whatsappHref(""), null);
  assert.equal(whatsappHref(null), null);
});

test("תצוגת התור הבא: תאריך ושעה בשעון הארגון, שירות חסר = 'לא הוזן', בלי עובד = בעל העסק", () => {
  const view = formatNextAppointment(
    { startTime: "2026-07-15T06:30:00.000Z", serviceName: null, employeeName: null },
    "Asia/Jerusalem"
  );
  assert.equal(view.timeLabel, "09:30", "06:30Z = 09:30 בישראל");
  assert.ok(view.dateLabel.includes("רביעי"), view.dateLabel);
  assert.equal(view.serviceLabel, NOT_PROVIDED);
  assert.equal(view.employeeLabel, "בעל העסק");

  const withAll = formatNextAppointment(
    { startTime: "2026-07-15T06:30:00.000Z", serviceName: "תספורת", employeeName: "יוסי" },
    "Asia/Jerusalem"
  );
  assert.equal(withAll.serviceLabel, "תספורת");
  assert.equal(withAll.employeeLabel, "יוסי");
});

test("mailto: קישור לאימייל תקין, ריק/לא-תקין -> null", () => {
  assert.equal(mailtoHref("dana@test.com"), "mailto:dana@test.com");
  assert.equal(mailtoHref(" dana@test.com "), "mailto:dana@test.com");
  assert.equal(mailtoHref("לא-מייל"), null);
  assert.equal(mailtoHref(null), null);
  assert.equal(mailtoHref(""), null);
});

test("maps: ניווט מעדיף Waze עם כתובת מקודדת, ריק -> null", () => {
  assert.equal(
    mapsHref("רחוב הרצל 1, תל אביב"),
    "https://www.waze.com/ul?q=" + encodeURIComponent("רחוב הרצל 1, תל אביב") + "&navigate=yes"
  );
  assert.equal(mapsHref("  "), null);
  assert.equal(mapsHref(null), null);
});

test("לשונית פגישות: הפגישה הבאה ראשונה, השאר מהחדש לישן", () => {
  const now = new Date("2026-07-14T12:00:00.000Z").getTime();
  const { rows, nextAppointmentId } = orderClientAppointmentsForTab(
    [
      { id: "past", startTime: "2026-07-10T10:00:00.000Z", status: "completed", serviceName: null, employeeName: null },
      { id: "later", startTime: "2026-07-25T10:00:00.000Z", status: "confirmed", serviceName: null, employeeName: null },
      { id: "soon", startTime: "2026-07-16T10:00:00.000Z", status: "pending", serviceName: null, employeeName: null },
      { id: "cancelled-soon", startTime: "2026-07-15T10:00:00.000Z", status: "cancelled", serviceName: null, employeeName: null },
    ],
    now
  );
  assert.equal(nextAppointmentId, "soon");
  assert.deepEqual(
    rows.map((row) => row.id),
    ["soon", "later", "cancelled-soon", "past"]
  );
});

test("מחיר פגישה: מספר → ₪, חוסר → לא הוזן", () => {
  assert.equal(formatAppointmentPrice(120), "₪120");
  assert.equal(formatAppointmentPrice(null), NOT_PROVIDED);
  assert.equal(formatAppointmentPrice(undefined), NOT_PROVIDED);
});
