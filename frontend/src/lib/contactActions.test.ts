import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGoogleMapsUrl,
  buildMailtoUrl,
  buildTelUrl,
  buildWazeUrl,
  buildWhatsAppUrl,
  isValidEmail,
  normalizePhoneForTel,
  normalizePhoneForWhatsApp,
} from "./contactActions";

test("normalizePhoneForTel: IL / +972 / 00 / international / junk", () => {
  assert.equal(normalizePhoneForTel("050-123-4567"), "+972501234567");
  assert.equal(normalizePhoneForTel("050 123 4567"), "+972501234567");
  assert.equal(normalizePhoneForTel("+972 50 123 4567"), "+972501234567");
  assert.equal(normalizePhoneForTel("00972501234567"), "+972501234567");
  assert.equal(normalizePhoneForTel("+1 (415) 523-8886"), "+14155238886");
  assert.equal(normalizePhoneForTel("123"), null);
  assert.equal(normalizePhoneForTel(""), null);
  assert.equal(normalizePhoneForTel(null), null);
});

test("normalizePhoneForWhatsApp: digits only, no + / dashes / spaces", () => {
  assert.equal(normalizePhoneForWhatsApp("050-123-4567"), "972501234567");
  assert.equal(normalizePhoneForWhatsApp("+972501234567"), "972501234567");
  assert.equal(normalizePhoneForWhatsApp("00972501234567"), "972501234567");
  assert.equal(normalizePhoneForWhatsApp("972501234567"), "972501234567");
  assert.equal(normalizePhoneForWhatsApp("+1 (415) 523-8886"), "14155238886");
  assert.equal(normalizePhoneForWhatsApp("123"), null);
  assert.equal(normalizePhoneForWhatsApp(null), null);
});

test("buildTelUrl / buildWhatsAppUrl produce valid links", () => {
  assert.equal(buildTelUrl("050-123-4567"), "tel:+972501234567");
  assert.equal(buildWhatsAppUrl("050-123-4567"), "https://wa.me/972501234567");
  assert.ok(!/[+\-() ]/.test(buildWhatsAppUrl("+972 50-123-4567")!.replace("https://wa.me/", "")));
  assert.equal(buildTelUrl(null), null);
  assert.equal(buildWhatsAppUrl(null), null);
});

test("isValidEmail / buildMailtoUrl reject empty and malformed", () => {
  assert.equal(isValidEmail("dana@test.com"), true);
  assert.equal(isValidEmail("no-reply@otter.ai"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(buildMailtoUrl(" dana@test.com "), "mailto:dana@test.com");
  assert.equal(buildMailtoUrl("nope"), null);
});

test("buildWazeUrl / buildGoogleMapsUrl encode address, empty -> null", () => {
  const addr = "רחוב הרצל 1, תל אביב";
  assert.equal(buildWazeUrl(addr), `https://www.waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes`);
  assert.equal(buildGoogleMapsUrl(addr), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`);
  assert.equal(buildWazeUrl("   "), null);
  assert.equal(buildGoogleMapsUrl(null), null);
});
