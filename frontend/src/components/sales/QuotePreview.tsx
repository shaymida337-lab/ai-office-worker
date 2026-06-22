"use client";

import { formatIls, type QuoteLineDraft, type SalesDeal } from "@/lib/salesUtils";
import { X } from "lucide-react";

type QuotePreviewProps = {
  deal: SalesDeal;
  lines: QuoteLineDraft[];
  total: number;
  validUntil: string;
  notes: string;
  onClose: () => void;
};

export function QuotePreview({ deal, lines, total, validUntil, notes, onClose }: QuotePreviewProps) {
  return (
    <div className="fixed inset-0 z-[140] grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="page-kicker">תצוגה מקדימה</div>
            <h2>הצעת מחיר</h2>
            <p className="text-sm text-ink-secondary">לכבוד: {deal.title}</p>
          </div>
          <button type="button" className="btn btn-secondary !w-auto" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid gap-2 text-sm text-ink-secondary">
          <span>תאריך: {new Date().toLocaleDateString("he-IL")}</span>
          <span>תוקף עד: {new Date(validUntil).toLocaleDateString("he-IL")}</span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-right text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="p-3">תיאור</th>
                <th className="p-3">כמות</th>
                <th className="p-3">מחיר</th>
                <th className="p-3">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3">{line.description}</td>
                  <td className="p-3">{line.quantity}</td>
                  <td className="p-3">{formatIls(line.unitPrice)}</td>
                  <td className="p-3">{formatIls(line.quantity * line.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="text-sm text-ink-secondary">
            {notes.trim() ? <p>{notes.trim()}</p> : null}
            <p className="mt-1">(כולל מע״מ)</p>
          </div>
          <strong className="text-xl text-ink-primary">{formatIls(total)}</strong>
        </div>

        <button type="button" className="btn mt-6 w-full" onClick={onClose}>
          סגור
        </button>
      </div>
    </div>
  );
}
