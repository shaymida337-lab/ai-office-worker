/**
 * תיקון #1 — טסטים לניקוד הביטחון המבוסס-מודל של מסמכי וואטסאפ. מוודאים
 * שהקבוע 0.85 הוחלף בניקוד אמיתי, ושכאשר ספק/סכום/תאריך אינם ודאיים הביטחון
 * יורד מתחת ל-0.8 כדי שהמסמך ינותב אוטומטית ל-needs_review.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeWhatsAppDocumentConfidence } from "./whatsappInvoiceIngestion.js";

const today = new Date().toISOString().slice(0, 10);

test("שדות ליבה מלאים + אות מודל טוב ⇒ ביטחון >= 0.8", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: "אלקטרה מיזוג אוויר בעמ",
    amount: 1170,
    date: today,
    invoiceNumber: "INV-2026-042",
    documentType: "invoice",
    modelConfidence: 0.9,
    ocrConfidence: 0.9,
  });
  assert.ok(confidence >= 0.8, `expected >= 0.8, got ${confidence}`);
});

test("ספק חסר ⇒ ביטחון < 0.8 (שער קשיח)", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: null,
    amount: 1170,
    date: today,
    invoiceNumber: "INV-1",
    documentType: "invoice",
    modelConfidence: 0.95,
    ocrConfidence: 0.95,
  });
  assert.ok(confidence < 0.8, `expected < 0.8, got ${confidence}`);
});

test("סכום חסר ⇒ ביטחון < 0.8 (שער קשיח)", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: "אלקטרה מיזוג אוויר בעמ",
    amount: null,
    date: today,
    invoiceNumber: "INV-1",
    documentType: "invoice",
    modelConfidence: 0.95,
    ocrConfidence: 0.95,
  });
  assert.ok(confidence < 0.8, `expected < 0.8, got ${confidence}`);
});

test("תאריך לא תקין/מחוץ לחלון ⇒ ביטחון < 0.8 (שער קשיח)", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: "אלקטרה מיזוג אוויר בעמ",
    amount: 1170,
    date: "1990-01-01", // מחוץ לחלון ±2 שנים
    invoiceNumber: "INV-1",
    documentType: "invoice",
    modelConfidence: 0.95,
    ocrConfidence: 0.95,
  });
  assert.ok(confidence < 0.8, `expected < 0.8, got ${confidence}`);
});

test("ספק זבל (placeholder) נחשב חסר ⇒ ביטחון < 0.8", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: "לא ידוע",
    amount: 1170,
    date: today,
    invoiceNumber: "INV-1",
    documentType: "invoice",
    modelConfidence: 0.95,
    ocrConfidence: 0.95,
  });
  assert.ok(confidence < 0.8, `expected < 0.8, got ${confidence}`);
});

test("ליבה מלאה אך אות מודל נמוך מאוד ⇒ יורד מתחת ל-0.8", () => {
  const confidence = computeWhatsAppDocumentConfidence({
    supplier: "אלקטרה מיזוג אוויר בעמ",
    amount: 1170,
    date: today,
    invoiceNumber: "INV-2026-042",
    documentType: "invoice",
    modelConfidence: 0.1,
    ocrConfidence: 0.1,
  });
  assert.ok(confidence < 0.8, `expected < 0.8, got ${confidence}`);
});
