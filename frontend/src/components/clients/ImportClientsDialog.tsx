"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, Loader2, UploadCloud, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

type ClientImportField = "name" | "phone" | "email" | "address" | "notes" | "unknown";

type ColumnMapping = {
  columnIndex: number;
  header: string;
  field: ClientImportField;
  confidence: number;
};

type PreviewRow = {
  rowIndex: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  action: "create" | "update" | "skip";
  matchClientId: string | null;
  matchClientName: string | null;
  error: string | null;
};

type PreviewResult = {
  fileType: "excel" | "csv";
  sheetName: string;
  mappings: ColumnMapping[];
  rows: PreviewRow[];
  warnings: string[];
  counts: { total: number; create: number; update: number; skip: number };
};

type ImportResult = {
  added: number;
  updated: number;
  skipped: number;
};

type Step = "upload" | "preview" | "done";

const FIELD_LABELS: Record<ClientImportField, string> = {
  name: "שם",
  phone: "טלפון",
  email: "מייל",
  address: "כתובת",
  notes: "הערות",
  unknown: "לא בשימוש",
};

const ACTION_LABELS: Record<PreviewRow["action"], string> = {
  create: "חדש",
  update: "עדכון",
  skip: "דילוג",
};

type ImportClientsDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

export function ImportClientsDialog({ open, onClose, onImported }: ImportClientsDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mappedFields = useMemo(
    () =>
      (preview?.mappings ?? [])
        .filter((mapping) => mapping.field !== "unknown")
        .map((mapping) => `${FIELD_LABELS[mapping.field]} ← ${mapping.header}`),
    [preview]
  );

  if (!open) return null;

  function resetAndClose() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setBusy(false);
    setError("");
    onClose();
  }

  async function handlePreview(nextFile: File) {
    setBusy(true);
    setError("");
    setFile(nextFile);
    try {
      const body = new FormData();
      body.append("file", nextFile);
      const next = await apiFetch<PreviewResult>("/api/clients/import/preview", {
        method: "POST",
        body,
      });
      setPreview(next);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "תצוגה מקדימה נכשלה");
      setPreview(null);
      setStep("upload");
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return;
    setBusy(true);
    setError("");
    try {
      const next = await apiFetch<ImportResult>("/api/clients/import", {
        method: "POST",
        body: JSON.stringify({
          rows: preview.rows.map((row) => ({
            name: row.name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            notes: row.notes,
          })),
        }),
      });
      setResult(next);
      setStep("done");
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ייבוא לקוחות נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink-primary">ייבוא לקוחות</h2>
            <p className="mt-1 text-sm text-ink-muted">העלאת Excel או CSV, זיהוי עמודות, תצוגה מקדימה וייבוא.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={resetAndClose} aria-label="סגור">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        {step === "upload" ? (
          <label className="grid cursor-pointer place-items-center gap-3 rounded-2xl border border-dashed border-accent-primary/40 bg-surface-secondary p-10 text-center">
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-accent-primary" /> : <UploadCloud className="h-8 w-8 text-accent-primary" />}
            <span className="font-semibold text-ink-primary">{busy ? "מזהה עמודות..." : "גרור קובץ לכאן או לחץ לבחירה"}</span>
            <span className="text-sm text-ink-muted">.xlsx, .xls, .csv</span>
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              disabled={busy}
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                if (nextFile) void handlePreview(nextFile);
              }}
            />
          </label>
        ) : null}

        {step === "preview" && preview ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{file?.name}</span>
              <span>·</span>
              <span>{preview.fileType.toUpperCase()}</span>
              <span>·</span>
              <span>{preview.counts.total} שורות</span>
            </div>

            <div className="rounded-2xl bg-surface-secondary p-3 text-sm">
              <strong className="block mb-2 text-ink-primary">זיהוי עמודות</strong>
              {mappedFields.length ? (
                <ul className="grid gap-1 md:grid-cols-2">
                  {mappedFields.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>לא זוהו עמודות אוטומטית</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="badge badge-ok">חדשים: {preview.counts.create}</span>
              <span className="badge badge-warn">עדכון (כפילות): {preview.counts.update}</span>
              <span className="badge">דילוג: {preview.counts.skip}</span>
            </div>

            {preview.warnings.length ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="overflow-auto rounded-2xl border border-black/5">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-secondary text-ink-muted">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">שם</th>
                    <th className="p-2 text-start">טלפון</th>
                    <th className="p-2 text-start">מייל</th>
                    <th className="p-2 text-start">כתובת</th>
                    <th className="p-2 text-start">הערות</th>
                    <th className="p-2 text-start">פעולה</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row) => (
                    <tr key={row.rowIndex} className="border-t border-black/5">
                      <td className="p-2">{row.rowIndex}</td>
                      <td className="p-2">{row.name || "—"}</td>
                      <td className="p-2" dir="ltr">
                        {row.phone || "—"}
                      </td>
                      <td className="p-2" dir="ltr">
                        {row.email || "—"}
                      </td>
                      <td className="p-2">{row.address || "—"}</td>
                      <td className="p-2">{row.notes || "—"}</td>
                      <td className="p-2">
                        {ACTION_LABELS[row.action]}
                        {row.action === "update" && row.matchClientName ? ` · ${row.matchClientName}` : ""}
                        {row.error ? ` · ${row.error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 50 ? (
                <p className="p-2 text-xs text-ink-muted">מוצגות 50 שורות ראשונות מתוך {preview.rows.length}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  setStep("upload");
                  setPreview(null);
                  setFile(null);
                }}
              >
                קובץ אחר
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || preview.counts.create + preview.counts.update === 0}
                onClick={() => void handleImport()}
              >
                {busy ? "מייבא..." : "ייבוא"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "done" && result ? (
          <div className="grid gap-4">
            <div className="rounded-2xl bg-surface-secondary p-4 text-sm">
              <p className="font-bold text-ink-primary mb-2">סיכום ייבוא</p>
              <ul className="grid gap-1">
                <li>לקוחות שנוספו: {result.added}</li>
                <li>לקוחות שעודכנו: {result.updated}</li>
                <li>דולגו בגלל שגיאות: {result.skipped}</li>
              </ul>
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn" onClick={resetAndClose}>
                סגור
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
