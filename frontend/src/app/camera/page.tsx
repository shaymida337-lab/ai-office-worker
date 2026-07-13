"use client";

import { useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type InvoicePreview = {
  supplier: string;
  amount: number | null;
  date: string | null;
  invoiceNumber: string | null;
  currency: string;
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
    setFileBase64(await toBase64(nextFile));
  }

  async function buildPreview() {
    if (!file || !fileBase64) {
      setError("בחר קובץ חשבונית לפני הסריקה.");
      return;
    }
    setPreviewing(true);
    setError("");
    setMessage("");
    try {
      const result = await apiFetch<InvoicePreview>("/api/camera/invoices/preview", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          fileBase64,
        }),
      });
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "סריקת החשבונית נכשלה");
    } finally {
      setPreviewing(false);
    }
  }

  async function saveInvoice() {
    if (!file || !fileBase64 || !preview) return;
    if (!preview.supplier || preview.amount == null) {
      setError("חסר שם ספק או סכום. אי אפשר לשמור את החשבונית.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/camera/invoices", {
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
        }),
      });
      setMessage("החשבונית נשמרה ונוספה לתשלומי ספקים.");
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
            <p><strong>ספק:</strong> {preview.supplier}</p>
            <p><strong>סכום:</strong> {preview.amount ?? "לא זוהה"}</p>
            <p><strong>מטבע:</strong> {preview.currency}</p>
            <p><strong>תאריך:</strong> {preview.date ?? "לא זוהה"}</p>
            <p><strong>מספר חשבונית:</strong> {preview.invoiceNumber ?? "לא זוהה"}</p>
            <button className="btn" onClick={saveInvoice} disabled={saving}>
              {saving ? "שומר..." : "אשר ושמור כתשלום ספק"}
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
