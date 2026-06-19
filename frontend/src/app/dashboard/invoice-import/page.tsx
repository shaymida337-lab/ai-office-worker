"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";

type ImportColumnRole =
  | "customerName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "amount"
  | "date"
  | "quantity"
  | "description"
  | "credit"
  | "debit"
  | "balance"
  | "reference"
  | "unknown";

type ImportFileKind = "sales" | "bank_statement" | "unknown";

type ColumnMapping = {
  columnIndex: number;
  header: string;
  role: ImportColumnRole;
  confidence: number;
};

type ImportPreviewResult = {
  fileType: "excel" | "csv";
  sheetName: string;
  headerRowIndex: number;
  fileKind: ImportFileKind;
  fileKindConfidence: number;
  fileKindReason: string;
  mappings: ColumnMapping[];
  sampleRows: string[][];
  allRows: string[][];
  totalDataRows: number;
  warnings: string[];
};

type ImportSaveResponse = {
  ok: true;
  savedCount: number;
  draftIds: string[];
  warnings: string[];
  confirmationMessage: string;
};

type Step = "upload" | "review" | "done";

const ROLE_OPTIONS: Array<{ value: ImportColumnRole; label: string }> = [
  { value: "customerName", label: "שם לקוח" },
  { value: "firstName", label: "שם פרטי" },
  { value: "lastName", label: "שם משפחה" },
  { value: "email", label: "מייל" },
  { value: "phone", label: "טלפון" },
  { value: "amount", label: "סכום" },
  { value: "date", label: "תאריך" },
  { value: "quantity", label: "כמות" },
  { value: "description", label: "תיאור" },
  { value: "credit", label: "זכות" },
  { value: "debit", label: "חובה" },
  { value: "balance", label: "יתרה" },
  { value: "reference", label: "אסמכתא" },
  { value: "unknown", label: "לא בשימוש" },
];

const roleLabel = (role: ImportColumnRole) =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;

export default function InvoiceImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [saveResult, setSaveResult] = useState<ImportSaveResponse | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");

  const sortedMappings = useMemo(
    () => [...mappings].sort((left, right) => left.columnIndex - right.columnIndex),
    [mappings],
  );

  const previewHeaders = useMemo(
    () => sortedMappings.map((mapping) => mapping.header),
    [sortedMappings],
  );

  const messageClasses = {
    info: "border-[#1D4ED8] bg-[#EFF6FF] text-[#111827]",
    success: "border-[#059669] bg-[#ECFDF5] text-[#111827]",
    error: "border-[#DC2626] bg-[#FEF2F2] text-[#111827]",
  }[messageTone];

  function resetToUpload() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMappings([]);
    setSaveResult(null);
    setMessage("");
  }

  function updateMappingRole(columnIndex: number, role: ImportColumnRole) {
    setMappings((current) =>
      current.map((mapping) =>
        mapping.columnIndex === columnIndex ? { ...mapping, role } : mapping,
      ),
    );
  }

  async function uploadAndDetect() {
    if (!file) {
      setMessageTone("error");
      setMessage("בחר קובץ Excel או CSV לפני ההעלאה.");
      return;
    }

    setUploading(true);
    setMessageTone("info");
    setMessage("מזהה עמודות ומכין תצוגה מקדימה...");
    setSaveResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiFetch<ImportPreviewResult>("/api/natalie/invoice-import/preview", {
        method: "POST",
        body: formData,
        timeoutMs: 60_000,
      });
      setPreview(result);
      setMappings(result.mappings);
      setStep("review");
      setMessageTone("success");
      setMessage("הקובץ נותח בהצלחה. בדוק את המיפוי ואשר לשמירה.");
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "זיהוי הקובץ נכשל");
    } finally {
      setUploading(false);
    }
  }

  async function saveDrafts() {
    if (!preview) return;

    setSaving(true);
    setMessageTone("info");
    setMessage("שומר טיוטות...");
    try {
      const result = await apiFetch<ImportSaveResponse>("/api/natalie/invoice-import/save", {
        method: "POST",
        body: JSON.stringify({
          rows: preview.allRows,
          mappings,
        }),
        timeoutMs: 60_000,
      });
      setSaveResult(result);
      setStep("done");
      setMessageTone("success");
      setMessage(result.confirmationMessage);
    } catch (err) {
      setMessageTone("error");
      setMessage(err instanceof Error ? err.message : "שמירת הטיוטות נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container invoice-import-page min-h-screen text-base text-[#111827]" dir="rtl" style={{ background: "#f8fafc" }}>
      <style>{`
        .invoice-import-page,
        .invoice-import-page :where(h1, h2, h3, p, span, div, label, th, td, button, a, input, select) {
          color: #111827;
        }
        .invoice-import-page :where(input, select) {
          background: #ffffff;
          border: 1px solid #e5e7eb;
        }
        .invoice-import-panel {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 1rem;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        }
        .invoice-import-page table th {
          background: #f3f4f6;
        }
        .invoice-import-page table td,
        .invoice-import-page table th {
          border-bottom: 1px solid #e5e7eb;
          padding: 0.75rem 1rem;
          text-align: right;
        }
      `}</style>

      <Nav />

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker text-[#111827]">ייבוא חשבוניות</div>
          <h1 className="text-[#111827]">ייבוא חשבוניות מקובץ</h1>
          <p className="text-[17px] font-medium leading-8 text-[#4B5563]">
            העלה קובץ Excel או CSV של מכירות/לקוחות. המערכת תזהה את העמודות, ותכין טיוטות חשבונית לאישורך.
          </p>
        </div>
        <Link
          href="/dashboard/invoices"
          className="inline-flex min-w-40 items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-bold text-[#111827] transition hover:bg-[#F3F4F6]"
        >
          חזרה לחשבוניות
        </Link>
      </div>

      {message && (
        <div className={`mb-6 rounded-2xl border p-4 text-base font-medium leading-7 ${messageClasses}`}>
          {message}
        </div>
      )}

      {step === "upload" && (
        <section className="invoice-import-panel p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] text-white">
              <UploadCloud className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-xl font-black">העלאת קובץ</h2>
              <p className="text-base text-[#4B5563]">קבצי Excel או CSV עם שורות מכירה או לקוחות.</p>
            </div>
          </div>

          <label className="mb-4 grid cursor-pointer place-items-center rounded-3xl border border-dashed border-[#93C5FD] bg-[#EFF6FF] p-8 text-center transition hover:bg-[#DBEAFE]">
            <FileSpreadsheet className="mb-3 h-10 w-10 text-[#1D4ED8]" />
            <span className="text-lg font-bold text-[#111827]">{file ? file.name : "בחר קובץ Excel או CSV"}</span>
            <span className="mt-2 text-base text-[#4B5563]">.xlsx, .xls, .csv</span>
            <input
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <button
            type="button"
            className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#1D4ED8] px-5 py-3 text-base font-black text-white transition hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
            onClick={uploadAndDetect}
            disabled={uploading || !file}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            {uploading ? "מזהה..." : "העלה וזהה"}
          </button>
        </section>
      )}

      {step === "review" && preview && (
        <div className="grid gap-6">
          <FileKindBanner fileKind={preview.fileKind} />

          <div className="rounded-2xl border border-[#F59E0B] bg-[#FFFBEB] p-4 text-base font-bold text-[#92400E]">
            ⚠️ טיוטות פנימיות בלבד — לא יונפקו חשבוניות מס רשמיות.
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-2xl border border-[#F59E0B] bg-[#FEF3C7] p-4">
              <div className="mb-2 flex items-center gap-2 font-black text-[#92400E]">
                <AlertTriangle className="h-5 w-5" />
                אזהרות מהזיהוי
              </div>
              <ul className="list-disc pr-5 text-base text-[#78350F]">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="invoice-import-panel p-6">
            <h2 className="mb-2 text-xl font-black">מיפוי עמודות</h2>
            <p className="mb-4 text-base text-[#4B5563]">בדוק את הזיהוי ותקן ידנית במידת הצורך.</p>
            <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
              <table className="min-w-full text-base">
                <thead>
                  <tr>
                    <th>עמודה בקובץ</th>
                    <th>זוהה כ-</th>
                    <th>תיקון</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMappings.map((mapping) => (
                    <tr key={mapping.columnIndex}>
                      <td className="font-semibold">{mapping.header || `עמודה ${mapping.columnIndex + 1}`}</td>
                      <td>{roleLabel(mapping.role)}</td>
                      <td>
                        <select
                          className="w-full min-w-[10rem] rounded-xl px-3 py-2 text-base font-semibold"
                          value={mapping.role}
                          onChange={(event) =>
                            updateMappingRole(mapping.columnIndex, event.target.value as ImportColumnRole)
                          }
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="invoice-import-panel p-6">
            <h2 className="mb-2 text-xl font-black">תצוגה מקדימה</h2>
            <p className="mb-4 text-base text-[#4B5563]">
              מציג {preview.sampleRows.length} מתוך {preview.totalDataRows} שורות
            </p>
            <div className="overflow-x-auto rounded-2xl border border-[#E5E7EB]">
              <table className="min-w-full text-base">
                <thead>
                  <tr>
                    {previewHeaders.map((header, index) => (
                      <th key={`${header}-${index}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {sortedMappings.map((mapping) => (
                        <td key={mapping.columnIndex}>{row[mapping.columnIndex] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-[#059669] bg-[#059669] px-5 py-3 text-base font-black text-white transition hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
              onClick={saveDrafts}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {saving ? "שומר..." : "אשר ושמור טיוטות"}
            </button>
            <button
              type="button"
              className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-5 py-3 text-base font-bold text-[#111827] transition hover:bg-[#F3F4F6]"
              onClick={resetToUpload}
              disabled={saving}
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {step === "done" && saveResult && (
        <section className="invoice-import-panel p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ECFDF5] text-[#059669]">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-xl font-black">השמירה הושלמה</h2>
              <p className="text-base font-semibold text-[#4B5563]">{saveResult.confirmationMessage}</p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-[#D1FAE5] bg-[#ECFDF5] p-4 text-base font-bold text-[#065F46]">
            נשמרו {saveResult.savedCount} טיוטות פנימיות.
          </div>

          {saveResult.warnings.length > 0 && (
            <div className="mb-4 rounded-2xl border border-[#F59E0B] bg-[#FEF3C7] p-4">
              <div className="mb-2 font-black text-[#92400E]">שורות שדולגו בשמירה</div>
              <ul className="list-disc pr-5 text-base text-[#78350F]">
                {saveResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#1D4ED8] px-5 py-3 text-base font-black text-white transition hover:bg-[#1E40AF]"
            onClick={resetToUpload}
          >
            ייבוא קובץ נוסף
          </button>
        </section>
      )}
    </div>
  );
}

function FileKindBanner({ fileKind }: { fileKind: ImportFileKind }) {
  if (fileKind === "sales") {
    return (
      <div className="rounded-2xl border border-[#059669] bg-[#ECFDF5] p-4 text-base font-bold text-[#065F46]">
        זוהה קובץ מכירות — אכין טיוטת חשבונית לכל שורה
      </div>
    );
  }

  if (fileKind === "bank_statement") {
    return (
      <div className="rounded-2xl border border-[#F59E0B] bg-[#FFFBEB] p-4 text-base font-bold text-[#92400E]">
        זוהה דוח בנק — קבצים כאלה אינם מיועדים להנפקת חשבוניות. בדוק לפני שתמשיך.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-base font-bold text-[#4B5563]">
      לא זוהה סוג הקובץ בוודאות — בדוק את המיפוי
    </div>
  );
}
