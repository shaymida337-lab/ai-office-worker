"use client";

import { useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type InvoicePreview = {
  supplier: string | null;
  amount: number | null;
  date: string | null;
  invoiceNumber: string | null;
  currency: string;
  /** persist-first: המסמך כבר שמור ב-DB תחת המזהה הזה מרגע ה-preview */
  reviewId?: string;
  extractionError?: string | null;
  uncertaintyReason?: string;
};

export default function CameraPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // שלושה input-ים נפרדים וקבועים — לא משנים capture דינמית על input אחד,
  // כי iOS Safari מתנהג בצורה לא עקבית כשמשנים את התכונה אחרי הרנדר.
  // capture קיים רק על input המצלמה; בלעדיו הגלריה/בורר הקבצים נפתחים כרגיל.
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(nextFile: File | null) {
    setFile(nextFile);
    setFileBase64("");
    setPreview(null);
    setMessage("");
    setError("");
    if (!nextFile) return;
    const base64 = await toBase64(nextFile);
    setFileBase64(base64);
    // העלאה מיידית: הקובץ נשלח לשרת ונשמר כ-draft ברגע הבחירה —
    // לא מחכים ללחיצה, כדי שהמסמך לעולם לא יישאר רק בזיכרון הדפדפן.
    await uploadAndPreview(nextFile, base64);
  }

  async function uploadAndPreview(nextFile: File, base64: string) {
    setPreviewing(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<InvoicePreview>("/api/camera/invoices/preview", {
        method: "POST",
        body: JSON.stringify({
          filename: nextFile.name,
          mimeType: nextFile.type,
          fileBase64: base64,
        }),
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "העלאת החשבונית נכשלה — נסה שוב");
    } finally {
      setPreviewing(false);
    }
  }

  async function buildPreview() {
    if (!file || !fileBase64) {
      setError("בחר קובץ חשבונית לפני הסריקה.");
      return;
    }
    await uploadAndPreview(file, fileBase64);
  }

  async function saveInvoice() {
    if (!file || !fileBase64 || !preview) return;
    // persist-first: אין יותר חסימה על ספק/סכום חסרים — המסמך כבר שמור
    // כ-draft מרגע ה-preview, והשמירה רק קובעת לאן הוא ממשיך.

    setSaving(true);
    setError("");
    try {
      const result = await apiFetch<{ status?: string; message?: string }>("/api/camera/invoices", {
        method: "POST",
        body: JSON.stringify({
          supplier: preview.supplier,
          amount: preview.amount,
          currency: preview.currency,
          invoiceDate: preview.date,
          invoiceNumber: preview.invoiceNumber,
          filename: file.name,
          mimeType: file.type,
          fileBase64,
          reviewId: preview.reviewId,
        }),
      });
      setMessage(
        result?.status === "needs_review"
          ? result.message ?? "המסמך נשמר ויופיע במסך השלמת חשבוניות להשלמת הפרטים."
          : "החשבונית נשמרה ונוספה לתשלומי ספקים."
      );
      setFile(null);
      setFileBase64("");
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שמירת החשבונית נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <Nav />
      <div className="mb-8"><div className="page-kicker">קליטת מסמכים</div><h1>צילום חשבונית</h1></div>
      <div className="card">
        <p>
          העלה תמונה או קובץ חשבונית. המערכת תחלץ את פרטי החשבונית ותאפשר לך לאשר לפני שמירה.
        </p>

        {/* מצלמה בלבד: capture="environment" פותח את המצלמה האחורית */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          aria-hidden
          data-testid="camera-input"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {/* גלריה בלבד: תמונות בלי capture — נפתחת ספריית התמונות.
            בכוונה רק jpeg/png (מה שהשרת מקבל): כש-HEIC לא ברשימה,
            iOS ממיר אוטומטית תמונות HEIC מהגלריה ל-JPEG בעת הבחירה. */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          className="hidden"
          aria-hidden
          data-testid="gallery-input"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {/* PDF בלבד: בורר הקבצים של המכשיר, מסונן ל-PDF */}
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-hidden
          data-testid="pdf-input"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            className="btn"
            onClick={() => {
              // איפוס לפני פתיחה — בחירה חוזרת של אותו קובץ תפעיל onChange
              if (cameraInputRef.current) cameraInputRef.current.value = "";
              cameraInputRef.current?.click();
            }}
          >
            📷 צלם תמונה
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (galleryInputRef.current) galleryInputRef.current.value = "";
              galleryInputRef.current?.click();
            }}
          >
            🖼 בחר מהגלריה
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (pdfInputRef.current) pdfInputRef.current.value = "";
              pdfInputRef.current?.click();
            }}
          >
            📄 בחר קובץ PDF
          </button>
        </div>
        {file && <p className="mt-3 rounded-2xl bg-surface-secondary p-3 text-ink-primary">נבחר קובץ: {file.name}</p>}
        <div className="mt-4">
          <button className="btn" onClick={buildPreview} disabled={!file || previewing}>
            {previewing ? "סורק חשבונית..." : "הצג תצוגה מקדימה"}
          </button>
        </div>

        {preview && (
          <div className="card mt-4">
            <h2>תצוגה מקדימה</h2>
            {preview.reviewId && (
              <p className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm">
                ✓ המסמך נשמר במערכת — גם אם חסרים פרטים הוא לא יאבד.
              </p>
            )}
            {preview.extractionError && (
              <p className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
                הסריקה האוטומטית נכשלה — המסמך ממתין במסך השלמת חשבוניות להשלמה ידנית.
              </p>
            )}
            <p><strong>ספק:</strong> {preview.supplier ?? "לא זוהה"}</p>
            <p><strong>סכום:</strong> {preview.amount ?? "לא זוהה"}</p>
            <p><strong>מטבע:</strong> {preview.currency}</p>
            <p><strong>תאריך:</strong> {preview.date ?? "לא זוהה"}</p>
            <p><strong>מספר חשבונית:</strong> {preview.invoiceNumber ?? "לא זוהה"}</p>
            <button className="btn" onClick={saveInvoice} disabled={saving}>
              {saving ? "שומר..." : preview.supplier && preview.amount != null ? "אשר ושמור כתשלום ספק" : "שמור להשלמה במסך השלמת חשבוניות"}
            </button>
          </div>
        )}

        {message && <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-100">{message}</div>}
        {error && <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">{error}</div>}
      </div>
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
