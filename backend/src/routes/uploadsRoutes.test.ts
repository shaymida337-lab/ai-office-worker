import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  isLocalUploadPath,
  signLocalUploadUrl,
  signLocalUploadUrlIfNeeded,
  uploadsRouter,
  UPLOAD_URL_TTL_MS,
} from "./uploadsRoutes.js";

const ORG_A = "org-uploads-a";
const ORG_B = "org-uploads-b";
const TEST_FILE = `test-${process.pid}-signed-upload.txt`;
const TEST_PATH = `/uploads/camera-invoices/${TEST_FILE}`;
const TEST_CONTENT = "signed upload contents";

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  options?: { containment?: "on" | "off" },
): Promise<T> {
  const uploadDir = path.join(process.cwd(), "uploads", "camera-invoices");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, TEST_FILE), TEST_CONTENT);

  const previous = {
    ingestion: process.env.FINANCIAL_INGESTION_CONTAINMENT,
    data: process.env.FINANCIAL_DATA_CONTAINMENT,
  };
  process.env.FINANCIAL_INGESTION_CONTAINMENT = options?.containment ?? "off";
  process.env.FINANCIAL_DATA_CONTAINMENT = "off";

  const app = express();
  app.use("/uploads", uploadsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await rm(path.join(uploadDir, TEST_FILE), { force: true });
    if (previous.ingestion === undefined) delete process.env.FINANCIAL_INGESTION_CONTAINMENT;
    else process.env.FINANCIAL_INGESTION_CONTAINMENT = previous.ingestion;
    if (previous.data === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous.data;
  }
}

test("unauthenticated request without signature is blocked", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${TEST_PATH}`);
    assert.equal(res.status, 403);
  });
});

test("guessed filename does not work without a valid signature", async () => {
  await withServer(async (baseUrl) => {
    // מנחש timestamp — בדיוק וקטור התקיפה המקורי
    const guessed = await fetch(`${baseUrl}/uploads/camera-invoices/${Date.now()}_invoice.jpg`);
    assert.equal(guessed.status, 403);

    // חתימה של קובץ אחר לא מכשירה את הקובץ הזה
    const otherSigned = signLocalUploadUrl("/uploads/camera-invoices/other-file.pdf", ORG_A);
    const query = otherSigned.split("?")[1];
    const res = await fetch(`${baseUrl}${TEST_PATH}?${query}`);
    assert.equal(res.status, 403);
  });
});

test("wrong organization (tampered org) is blocked", async () => {
  await withServer(async (baseUrl) => {
    const signedForA = signLocalUploadUrl(TEST_PATH, ORG_A);
    const tampered = signedForA.replace(`org=${ORG_A}`, `org=${ORG_B}`);
    const res = await fetch(`${baseUrl}${tampered}`);
    assert.equal(res.status, 403);
  });
});

test("correct organization signature can access the file", async () => {
  await withServer(async (baseUrl) => {
    const signed = signLocalUploadUrl(TEST_PATH, ORG_A);
    const res = await fetch(`${baseUrl}${signed}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), TEST_CONTENT);
  });
});

test("expired signature is blocked", async () => {
  await withServer(async (baseUrl) => {
    const past = Date.now() - UPLOAD_URL_TTL_MS - 60_000;
    const signed = signLocalUploadUrl(TEST_PATH, ORG_A, past);
    const res = await fetch(`${baseUrl}${signed}`);
    assert.equal(res.status, 403);
  });
});

test("path traversal and unknown channel dirs return 404", async () => {
  await withServer(async (baseUrl) => {
    const traversal = await fetch(`${baseUrl}/uploads/camera-invoices/%2e%2e`);
    assert.equal(traversal.status, 404);
    const unknownChannel = await fetch(`${baseUrl}/uploads/secrets/${TEST_FILE}`);
    assert.equal(unknownChannel.status, 404);
  });
});

test("signLocalUploadUrlIfNeeded signs local paths and passes external links through", () => {
  const signed = signLocalUploadUrlIfNeeded(TEST_PATH, ORG_A);
  assert.ok(signed?.startsWith("/uploads/camera-invoices/"));
  assert.match(signed ?? "", /\?org=org-uploads-a&exp=\d+&sig=[0-9a-f]{64}$/);

  const driveUrl = "https://drive.google.com/file/d/abc123/view";
  assert.equal(signLocalUploadUrlIfNeeded(driveUrl, ORG_A), driveUrl);
  assert.equal(signLocalUploadUrlIfNeeded(null, ORG_A), null);
  // בלי ארגון אין חתימה — הנתיב חוזר כמו שהוא (וממילא ייחסם בהגשה)
  assert.equal(signLocalUploadUrlIfNeeded(TEST_PATH, null), TEST_PATH);
});

test("existing document preview flow keeps working: stored path -> signed url -> served file", async () => {
  await withServer(async (baseUrl) => {
    // מדמה את מה שה-API עושה לרשומת review עם driveFileUrl מקומי
    const stored = TEST_PATH; // כפי שנשמר ב-DB על ידי saveLocalIngestedDocument
    assert.ok(isLocalUploadPath(stored));
    const apiResponseUrl = signLocalUploadUrlIfNeeded(stored, ORG_A);
    assert.ok(apiResponseUrl && apiResponseUrl !== stored);
    // ה-frontend מוסיף רק את בסיס ה-API (drivePreviewUrl) — לא משנה את ה-query
    const res = await fetch(`${baseUrl}${apiResponseUrl}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), TEST_CONTENT);
  });
});

test("containment on: signed GET still serves saved upload files (read path)", async () => {
  await withServer(async (baseUrl) => {
    const signed = signLocalUploadUrl(TEST_PATH, ORG_A);
    const res = await fetch(`${baseUrl}${signed}`, {
      headers: { Accept: "text/html,application/xhtml+xml,*/*" },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), TEST_CONTENT);

    const missingSigned = signLocalUploadUrl(
      `/uploads/camera-invoices/missing-${process.pid}-does-not-exist.pdf`,
      ORG_A,
    );
    const missing = await fetch(`${baseUrl}${missingSigned}`);
    assert.equal(missing.status, 404);
    const body = (await missing.json()) as { error?: string };
    assert.equal(body.error, "File not found");
  }, { containment: "on" });
});
