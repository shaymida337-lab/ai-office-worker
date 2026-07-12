import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadAlertMessage,
  computeLeadSummary,
  isPlatformAdmin,
  isValidLeadStatus,
} from "./leadAdminService.js";

test("platform admin gate: allowlist only, case-insensitive, empty=deny-all", () => {
  assert.equal(isPlatformAdmin("shay@example.com", ["shay@example.com"]), true);
  assert.equal(isPlatformAdmin("SHAY@Example.com", ["shay@example.com"]), true);
  assert.equal(isPlatformAdmin("customer@biz.co.il", ["shay@example.com"]), false);
  assert.equal(isPlatformAdmin("shay@example.com", []), false);
  assert.equal(isPlatformAdmin(undefined, ["shay@example.com"]), false);
});

test("lead status validation", () => {
  for (const status of ["new", "contacted", "qualified", "converted", "lost"]) {
    assert.equal(isValidLeadStatus(status), true);
  }
  assert.equal(isValidLeadStatus("deleted"), false);
  assert.equal(isValidLeadStatus(""), false);
  assert.equal(isValidLeadStatus(null), false);
});

test("alert message includes name/phone/plan/business + admin link, no email", () => {
  const message = buildLeadAlertMessage(
    { name: "דנה", phone: "0501234567", businessType: "קוסמטיקה", planInterest: "growth" },
    "https://ai-office-worker.com/admin/leads?lead=abc"
  );
  assert.ok(message.includes("🎉"));
  assert.ok(message.includes("דנה"));
  assert.ok(message.includes("0501234567"));
  assert.ok(message.includes("199"));
  assert.ok(message.includes("/admin/leads?lead=abc"));
  assert.ok(!message.includes("@"), "email must not appear in alert channel");
});

test("summary computes windows and statuses", async () => {
  const now = new Date("2026-07-12T12:00:00Z");
  const calls: Record<string, unknown>[] = [];
  const summary = await computeLeadSummary(
    {
      count: async (where) => {
        calls.push(where);
        if ((where as { status?: string }).status === "new") return 3;
        if ((where as { status?: string }).status === "qualified") return 2;
        if ((where as { status?: string }).status === "converted") return 1;
        return 10;
      },
      latestCreatedAt: async () => new Date("2026-07-12T11:59:00Z"),
    },
    now
  );
  assert.equal(summary.newCount, 3);
  assert.equal(summary.qualified, 2);
  assert.equal(summary.converted, 1);
  assert.equal(summary.latestCreatedAt, "2026-07-12T11:59:00.000Z");
  assert.equal(calls.length, 6);
});
