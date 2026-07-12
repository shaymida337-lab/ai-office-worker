import test from "node:test";
import assert from "node:assert/strict";
import { buildShareHref, SHARE_PLATFORMS, shareUrlFor } from "./shareLinks.js";

test("every shared URL carries a platform ref for future attribution", () => {
  for (const { platform } of SHARE_PLATFORMS) {
    assert.ok(shareUrlFor(platform).includes(`?ref=share-${platform}`));
  }
});

test("whatsapp href encodes text + url", () => {
  const href = buildShareHref("whatsapp");
  assert.ok(href.startsWith("https://wa.me/?text="));
  const decoded = decodeURIComponent(href.split("text=")[1]);
  assert.ok(decoded.includes("נטלי"));
  assert.ok(decoded.includes("https://ai-office-worker.com/?ref=share-whatsapp"));
});

test("facebook/linkedin hrefs carry encoded url", () => {
  assert.ok(buildShareHref("facebook").includes(encodeURIComponent("https://ai-office-worker.com/?ref=share-facebook")));
  assert.ok(buildShareHref("linkedin").startsWith("https://www.linkedin.com/sharing/share-offsite/?url="));
});

test("x href has short text + url params", () => {
  const href = buildShareHref("x");
  assert.ok(href.startsWith("https://twitter.com/intent/tweet?text="));
  assert.ok(href.includes("&url="));
});

test("email href includes subject and body", () => {
  const href = buildShareHref("email");
  assert.ok(href.startsWith("mailto:?subject="));
  assert.ok(href.includes("&body="));
});

test("copy returns plain url", () => {
  assert.equal(buildShareHref("copy"), "https://ai-office-worker.com/?ref=share-copy");
});

test("share texts stay short (tweet-safe)", async () => {
  const { SHARE_TEXTS } = await import("./shareLinks.js");
  assert.ok(SHARE_TEXTS.x.length <= 120);
  assert.ok(SHARE_TEXTS.whatsapp.length <= 160);
});
