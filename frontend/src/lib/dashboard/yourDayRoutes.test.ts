import assert from "node:assert/strict";
import test from "node:test";
import { resolveYourDayHref, YOUR_DAY_ROUTE_MAP } from "./yourDayRoutes.js";

test("route map covers payment destinations", () => {
  assert.equal(YOUR_DAY_ROUTE_MAP.payment_overdue, "/payments");
  assert.equal(YOUR_DAY_ROUTE_MAP.payment_pending, "/payments");
});

test("route map covers document and task destinations", () => {
  assert.equal(resolveYourDayHref("document_review"), "/dashboard/document-reviews");
  assert.equal(resolveYourDayHref("open_task"), "/tasks");
});

test("route map covers calendar and accountant destinations", () => {
  assert.equal(resolveYourDayHref("appointment"), "/dashboard/calendar");
  assert.equal(resolveYourDayHref("monthly_report"), "/dashboard/accountant");
});

test("all clear is informational with no href", () => {
  assert.equal(resolveYourDayHref("all_clear"), null);
});
