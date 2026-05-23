"use client";

import { useState } from "react";
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
      <h1>צילום חשבונית</h1>
      <Nav />
      <div className="card">
        <p style={{ color: "var(--muted)" }}>
          העלה JPG, PNG או PDF. Claude יחלץ את פרטי החשבונית ותוכל לאשר לפני שמירה.
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png,.pdf,application/pdf"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        <div style={{ marginTop: "1rem" }}>
          <button className="btn" onClick={buildPreview} disabled={!file || previewing}>
            {previewing ? "סורק חשבונית..." : "הצג תצוגה מקדימה"}
          </button>
        </div>

        {preview && (
          <div className="card" style={{ marginTop: "1rem" }}>
            <h2>תצוגה מקדימה</h2>
            <p><strong>ספק:</strong> {preview.supplier}</p>
            <p><strong>סכום:</strong> {preview.amount ?? "לא זוהה"}</p>
            <p><strong>מטבע:</strong> {preview.currency}</p>
            <p><strong>תאריך:</strong> {preview.date ?? "לא זוהה"}</p>
            <p><strong>מספר חשבונית:</strong> {preview.invoiceNumber ?? "לא זוהה"}</p>
            <button className="btn" onClick={saveInvoice} disabled={saving}>
              {saving ? "שומר..." : "אשר ושמור Payment"}
            </button>
          </div>
        )}

        {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
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
