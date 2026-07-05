import assert from "node:assert/strict";
import test from "node:test";
import { buildMorningGreeting } from "./morningBrief";

test("buildMorningGreeting uses morning welcome for new users", () => {
  const greeting = buildMorningGreeting({
    ownerFirstName: "שי",
    returningUser: false,
    hasWorkToday: true,
    now: new Date("2026-07-02T08:00:00"),
  });
  assert.match(greeting.headline, /בוקר טוב, שי/);
  assert.equal(greeting.leadIn, "הנה מה שכבר עשיתי עבורך היום");
});

test("buildMorningGreeting welcomes returning users", () => {
  const greeting = buildMorningGreeting({
    ownerFirstName: "שי",
    returningUser: true,
    hasWorkToday: false,
    now: new Date("2026-07-02T14:00:00"),
  });
  assert.match(greeting.headline, /ברוך הבא חזרה, שי/);
});

test("buildMorningGreeting uses stable headline before client clock is ready", () => {
  const greeting = buildMorningGreeting({
    ownerFirstName: "שי",
    returningUser: true,
    hasWorkToday: true,
    clockReady: false,
    now: new Date("2026-07-02T08:00:00"),
  });
  assert.equal(greeting.headline, "שלום, שי");
});
