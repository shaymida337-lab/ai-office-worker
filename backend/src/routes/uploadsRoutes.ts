import { Router } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../lib/config.js";
import {
  FINANCIAL_DATA_CONTAINMENT_CODE,
  isFinancialDataContainmentActive,
} from "../services/p0/financialContainment.js";

/**
 * הגשת קבצי /uploads (תצוגות מסמכים ממצלמה/וואטסאפ/ג'ימייל) בחתימת HMAC בלבד.
 *
 * למה חתימה ולא JWT: התצוגות נטענות ב-iframe/window.open שלא שולחים כותרת
 * Authorization. ה-URL החתום מונפק רק בתוך תשובות API שכבר עברו אימות ובידוד
 * ארגוני, והחתימה קושרת את הנתיב לארגון ולתפוגה — ניחוש שם קובץ (הבעיה
 * המקורית: שמות מבוססי timestamp) לא עובר בלי חתימה תקפה.
 */

export const UPLOAD_URL_TTL_MS = 4 * 60 * 60 * 1000; // 4 שעות; רענון דף מנפיק חתימות חדשות

const UPLOAD_CHANNEL_DIRS = new Set(["whatsapp-invoices", "camera-invoices", "gmail-invoices"]);
const LOCAL_UPLOAD_PATH_REGEX = /^\/uploads\/(whatsapp|camera|gmail)-invoices\/[^/\\]+$/;

export function isLocalUploadPath(url: unknown): url is string {
  return typeof url === "string" && LOCAL_UPLOAD_PATH_REGEX.test(url);
}

function uploadSignature(pathname: string, organizationId: string, expiresAt: number): string {
  return createHmac("sha256", config.jwtSecret)
    .update(`${pathname}|${organizationId}|${expiresAt}`)
    .digest("hex");
}

/**
 * חותם נתיב /uploads קנוני (לא מקודד) עבור ארגון. שם הקובץ מקודד ב-URL המוחזר
 * כדי שתווים כמו רווח/# לא ישברו את הבקשה, אבל החתימה מחושבת על הנתיב המפוענח.
 */
export function signLocalUploadUrl(pathname: string, organizationId: string, now = Date.now()): string {
  const expiresAt = now + UPLOAD_URL_TTL_MS;
  const signature = uploadSignature(pathname, organizationId, expiresAt);
  const separatorIndex = pathname.lastIndexOf("/");
  const dirPart = pathname.slice(0, separatorIndex);
  const fileName = pathname.slice(separatorIndex + 1);
  return `${dirPart}/${encodeURIComponent(fileName)}?org=${encodeURIComponent(organizationId)}&exp=${expiresAt}&sig=${signature}`;
}

/** קישורי Drive/חיצוניים עוברים כמו שהם; רק נתיבי /uploads מקומיים נחתמים. */
export function signLocalUploadUrlIfNeeded(
  url: string | null | undefined,
  organizationId: string | null | undefined
): string | null {
  if (url == null) return null;
  if (!organizationId || !isLocalUploadPath(url)) return url;
  return signLocalUploadUrl(url, organizationId);
}

function signatureMatches(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export const uploadsRouter = Router();

uploadsRouter.get("/:channelDir/:fileName", (req, res) => {
  if (isFinancialDataContainmentActive()) {
    res.status(503).json({
      error: "Financial documents are temporarily unavailable while tenant isolation is verified.",
      code: FINANCIAL_DATA_CONTAINMENT_CODE,
    });
    return;
  }

  const channelDir = String(req.params.channelDir ?? "");
  const fileName = String(req.params.fileName ?? "");

  // נתיב קנוני בלבד: תיקיית ערוץ מוכרת ושם קובץ בודד בלי רכיבי נתיב
  if (
    !UPLOAD_CHANNEL_DIRS.has(channelDir) ||
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName !== path.basename(fileName) ||
    !LOCAL_UPLOAD_PATH_REGEX.test(`/uploads/${channelDir}/${fileName}`)
  ) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const organizationId = typeof req.query.org === "string" ? req.query.org : "";
  const expiresAtRaw = typeof req.query.exp === "string" ? req.query.exp : "";
  const providedSignature = typeof req.query.sig === "string" ? req.query.sig : "";
  const expiresAt = Number(expiresAtRaw);

  if (!organizationId || !providedSignature || !Number.isFinite(expiresAt)) {
    res.status(403).json({ error: "Missing document access signature" });
    return;
  }
  if (expiresAt < Date.now()) {
    res.status(403).json({ error: "Document access signature expired" });
    return;
  }
  const pathname = `/uploads/${channelDir}/${fileName}`;
  if (!signatureMatches(uploadSignature(pathname, organizationId, expiresAt), providedSignature)) {
    res.status(403).json({ error: "Invalid document access signature" });
    return;
  }

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const filePath = path.resolve(uploadsRoot, channelDir, fileName);
  if (!filePath.startsWith(uploadsRoot + path.sep) || !existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendFile(filePath);
});
