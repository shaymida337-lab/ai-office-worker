import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBusinessDateString,
  clampHistoricalScanYears,
  isWithinBusinessDateWindow,
  normalizeBusinessDate,
} from "./businessDate.js";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

test("isWithinBusinessDateWindow: past 2y (default) / future 1y bounds", () => {
  assert.equal(isWithinBusinessDateWindow(new Date()), true);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(-600)), true); // בתוך שנתיים אחורה
  assert.equal(isWithinBusinessDateWindow(daysFromNow(-800)), false); // מעבר לשנתיים אחורה
  // עתיד: מוגבל לשנה אחת בלבד (הפיצ'ר ההיסטורי מרחיב רק את העבר)
  assert.equal(isWithinBusinessDateWindow(daysFromNow(300)), true);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(400)), false); // >1 שנה קדימה
  assert.equal(isWithinBusinessDateWindow(new Date("invalid")), false);
});

test("isWithinBusinessDateWindow: dynamic maxPastYears extends the past window", () => {
  const fourYearsAgo = daysFromNow(-4 * 365 - 10);
  // ברירת מחדל (שנתיים) — 4 שנים אחורה לא תקין
  assert.equal(isWithinBusinessDateWindow(fourYearsAgo), false);
  // עומק 5 שנים — אותו תאריך תקין
  assert.equal(isWithinBusinessDateWindow(fourYearsAgo, Date.now(), 5), true);
  // העתיד נשאר חסום לשנה גם עם עומק היסטורי גדול
  assert.equal(isWithinBusinessDateWindow(daysFromNow(400), Date.now(), 5), false);
});

test("clampHistoricalScanYears: valid 1-5, else default 2", () => {
  assert.equal(clampHistoricalScanYears(1), 1);
  assert.equal(clampHistoricalScanYears(5), 5);
  assert.equal(clampHistoricalScanYears("3"), 3);
  assert.equal(clampHistoricalScanYears(0), 2);
  assert.equal(clampHistoricalScanYears(6), 2);
  assert.equal(clampHistoricalScanYears(2.5), 2);
  assert.equal(clampHistoricalScanYears(undefined), 2);
  assert.equal(clampHistoricalScanYears("nope"), 2);
});

test("normalizeBusinessDate: valid dates pass, out-of-window falls back (F4)", () => {
  const fallback = new Date("2026-06-01T00:00:00Z");
  const recent = daysFromNow(-30);
  assert.equal(normalizeBusinessDate(recent.toISOString(), fallback)?.getTime(), recent.getTime());
  // תאריך עתידי מעבר לשנתיים — נופל ל-fallback (זהה להתנהגות Gmail המקורית)
  assert.equal(normalizeBusinessDate(daysFromNow(900).toISOString(), fallback), fallback);
  // תאריך עתיק — נופל ל-fallback
  assert.equal(normalizeBusinessDate("2019-01-01", fallback), fallback);
  // ערך חסר/זבל — fallback
  assert.equal(normalizeBusinessDate(null, fallback), fallback);
  assert.equal(normalizeBusinessDate("not-a-date", fallback), fallback);
  // מקבל גם Date instance
  assert.equal(normalizeBusinessDate(recent, null)?.getTime(), recent.getTime());
});

test("clampBusinessDateString: WhatsApp/extractor string path (F4)", () => {
  const recentIso = daysFromNow(-10).toISOString().slice(0, 10);
  assert.equal(clampBusinessDateString(recentIso), recentIso);
  assert.equal(clampBusinessDateString("2019-05-05"), null);
  assert.equal(clampBusinessDateString(daysFromNow(900).toISOString()), null);
  assert.equal(clampBusinessDateString(null), null);
  assert.equal(clampBusinessDateString("   "), null);
  assert.equal(clampBusinessDateString("garbage"), null);
});

test("clampBusinessDateString: dynamic maxPastYears keeps older documents valid", () => {
  const fourYearsAgoIso = daysFromNow(-4 * 365 - 10).toISOString().slice(0, 10);
  // ברירת מחדל (שנתיים) — פסול
  assert.equal(clampBusinessDateString(fourYearsAgoIso), null);
  // עומק 5 שנים — תקין ומוחזר כמות שהוא
  assert.equal(clampBusinessDateString(fourYearsAgoIso, 5), fourYearsAgoIso);
});
