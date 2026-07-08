import assert from "node:assert/strict";
import test from "node:test";
import { resolveNatalieRecommendation } from "../natalie/recommendation.js";
import {
  buildHeroBriefing,
  heroBriefingHasSyncDuplicate,
  resolveHeroCtaIntent,
} from "./heroBriefing.js";

test("hero briefing uses urgent payment recommendation without sync language", () => {
  const recommendation = resolveNatalieRecommendation({
    gmailConnected: true,
    unpaidPayments: [{ id: "1", supplier: "ספק א", paid: false, date: new Date().toISOString() }],
  });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: false,
    gmailConnected: true,
    firstVisitMode: false,
    pendingDecisionCount: 1,
  });
  assert.equal(briefing.ctaIntent, "navigate");
  assert.match(briefing.recommendation, /תשלום|ספק/);
  assert.equal(heroBriefingHasSyncDuplicate(briefing.recommendation), false);
});

test("hero briefing connect Gmail path has one CTA", () => {
  const recommendation = resolveNatalieRecommendation({ gmailConnected: false });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: false,
    gmailConnected: false,
    firstVisitMode: true,
    pendingDecisionCount: 0,
  });
  assert.equal(briefing.ctaIntent, "connect_gmail");
  assert.equal(briefing.ctaLabel, "חבר ג׳ימייל");
  assert.equal(heroBriefingHasSyncDuplicate(briefing.recommendation), false);
});

test("hero briefing first visit offers run scan CTA", () => {
  const recommendation = resolveNatalieRecommendation({ gmailConnected: true });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: false,
    gmailConnected: true,
    firstVisitMode: true,
    pendingDecisionCount: 0,
  });
  assert.equal(briefing.ctaIntent, "run_scan");
  assert.equal(briefing.ctaLabel, "התחל סריקה");
});

test("hero briefing scanning calm state avoids sync duplication", () => {
  const recommendation = resolveNatalieRecommendation({ gmailConnected: true, scanRunning: true });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: true,
    gmailConnected: true,
    firstVisitMode: false,
    pendingDecisionCount: 0,
  });
  assert.match(briefing.recommendation, /ממשיכה לעבור/);
  assert.equal(heroBriefingHasSyncDuplicate(briefing.recommendation), false);
});

test("hero briefing all clear uses calm assistant copy", () => {
  const recommendation = resolveNatalieRecommendation({ gmailConnected: true });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: false,
    gmailConnected: true,
    firstVisitMode: false,
    pendingDecisionCount: 0,
  });
  assert.equal(briefing.recommendation, "לא נדרש ממך שום טיפול כרגע.");
  assert.equal(briefing.ctaIntent, "ask_natalie");
});

test("resolveHeroCtaIntent prioritizes connect before navigation", () => {
  const recommendation = resolveNatalieRecommendation({ gmailConnected: false });
  assert.equal(
    resolveHeroCtaIntent({
      recommendation,
      firstVisitMode: false,
      scanRunning: false,
      gmailConnected: false,
    }),
    "connect_gmail"
  );
});

test("REGRESSION: hero briefing never mirrors status pill connected copy", () => {
  const syncDuplicate = "מחוברת, סורקת ועובדת עבורך";
  assert.equal(heroBriefingHasSyncDuplicate(syncDuplicate), true);
  const recommendation = resolveNatalieRecommendation({ gmailConnected: true });
  const briefing = buildHeroBriefing({
    recommendation,
    scanRunning: false,
    gmailConnected: true,
    firstVisitMode: false,
    pendingDecisionCount: 0,
  });
  assert.equal(heroBriefingHasSyncDuplicate(briefing.recommendation), false);
});
