import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBusinessDateString,
  isWithinBusinessDateWindow,
  normalizeBusinessDate,
} from "./businessDate.js";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

test("isWithinBusinessDateWindow: ±2y bounds", () => {
  assert.equal(isWithinBusinessDateWindow(new Date()), true);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(-600)), true);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(600)), true);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(-800)), false);
  assert.equal(isWithinBusinessDateWindow(daysFromNow(800)), false);
  assert.equal(isWithinBusinessDateWindow(new Date("invalid")), false);
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
