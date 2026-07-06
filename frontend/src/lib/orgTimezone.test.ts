import test from "node:test";
import assert from "node:assert/strict";

import { dateInputValueInTimeZone, timeInputValueInTimeZone } from "./orgTimezone.js";

test("input values render an instant in the org timezone, not the runtime timezone", () => {
  // 11:00Z בקיץ ישראלי (IDT +03) = 14:00 מקומית
  const summer = new Date("2026-07-10T11:00:00.000Z");
  assert.equal(dateInputValueInTimeZone(summer, "Asia/Jerusalem"), "2026-07-10");
  assert.equal(timeInputValueInTimeZone(summer, "Asia/Jerusalem"), "14:00");
});

test("input values respect DST winter offset", () => {
  // 12:00Z בחורף ישראלי (IST +02) = 14:00 מקומית
  const winter = new Date("2026-01-15T12:00:00.000Z");
  assert.equal(timeInputValueInTimeZone(winter, "Asia/Jerusalem"), "14:00");
});

test("input values roll the date across midnight in the org timezone", () => {
  // 22:30Z בקיץ = 01:30 למחרת בישראל
  const lateNight = new Date("2026-07-10T22:30:00.000Z");
  assert.equal(dateInputValueInTimeZone(lateNight, "Asia/Jerusalem"), "2026-07-11");
  assert.equal(timeInputValueInTimeZone(lateNight, "Asia/Jerusalem"), "01:30");
});

test("round-trip: prefill values re-serialize to the same naive wall-clock the backend stored", () => {
  // ה-backend שמר "2026-07-10T14:00" נאיבי ב-Asia/Jerusalem => האינסטנט 11:00Z.
  // ה-prefill חייב להחזיר בדיוק את אותם date/time כדי ששמירה חוזרת לא תזיז את השעה.
  const storedInstant = new Date("2026-07-10T11:00:00.000Z");
  const date = dateInputValueInTimeZone(storedInstant, "Asia/Jerusalem");
  const time = timeInputValueInTimeZone(storedInstant, "Asia/Jerusalem");
  assert.equal(`${date}T${time}`, "2026-07-10T14:00");
});
