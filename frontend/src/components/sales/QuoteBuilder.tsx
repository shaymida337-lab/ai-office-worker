"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  computeLinesTotal,
  defaultValidUntilInputValue,
  draftQuote,
  formatIls,
  linesFromQuote,
  newLineDraft,
  quoteLinesPayload,
  type QuoteLineDraft,
  type SalesDeal,
  type SalesService,
  validateQuoteDraft,
} from "@/lib/salesUtils";
import { Eye, Plus, Trash2 } from "lucide-react";
import { QuotePreview } from "./QuotePreview";

type QuoteBuilderProps = {
  deal: SalesDeal;
  onSaved: (deal: SalesDeal) => void;
  onCancel?: () => void;
};

export function QuoteBuilder({ deal, onSaved, onCancel }: QuoteBuilderProps) {
  const existingDraft = draftQuote(deal);
  const [services, setServices] = useState<SalesService[]>([]);
  const [servicePick, setServicePick] = useState("");
  const [lines, setLines] = useState<QuoteLineDraft[]>(() =>
    existingDraft ? linesFromQuote(existingDraft) : [newLineDraft()]
  );
  const [validUntil, setValidUntil] = useState(() =>
    existingDraft?.validUntil
      ? new Date(existingDraft.validUntil).toISOString().slice(0, 10)
      : defaultValidUntilInputValue()
  );
  const [notes, setNotes] = useState(existingDraft?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const total = useMemo(() => computeLinesTotal(lines), [lines]);
  const activeServices = useMemo(() => services.filter((service) => service.isActive), [services]);

  useEffect(() => {
    apiFetch<SalesService[]>("/api/services")
      .then(setServices)
      .catch(() => setServices([]));
  }, []);

  function updateLine(key: string, patch: Partial<QuoteLineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines((current) => (current.length <= 1 ? current : current.filter((line) => line.key !== key)));
  }

  function addServiceLine() {
    const service = activeServices.find((item) => item.id === servicePick);
    if (!service) {
      setError("בחר שירות מהקטalog");
      return;
    }
    if (service.price == null || service.price <= 0) {
      setError("לשירות שנבחר אין מחיר — הוסף שורה חופשית");
      return;
    }
    setError("");
    setLines((current) => [
      ...current,
      newLineDraft({
        serviceId: service.id,
        description: service.name,
        quantity: 1,
        unitPrice: service.price ?? 0,
      }),
    ]);
    setServicePick("");
  }

  function addFreeLine() {
    setLines((current) => [...current, newLineDraft()]);
  }

  async function saveDraft() {
    const validationError = validateQuoteDraft(lines, validUntil);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        lines: quoteLinesPayload(lines),
        validUntil,
        notes: notes.trim() || undefined,
      };

      const currentDraft = draftQuote(deal);
      if (currentDraft) {
        await apiFetch(`/api/quotes/${currentDraft.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/deals/${deal.id}/quotes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      const refreshed = await apiFetch<{ deal: SalesDeal }>(`/api/deals/${deal.id}`);
      onSaved(refreshed.deal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירת הצעה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  function openPreview() {
    const validationError = validateQuoteDraft(lines, validUntil);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setPreviewOpen(true);
  }

  return (
    <>
      <section className="mt-6 rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-ink-primary">
            {existingDraft ? "עריכת הצעת מחיר" : "הצעת מחיר חדשה"}
          </h3>
          {onCancel && (
            <button type="button" className="btn btn-secondary !w-auto" onClick={onCancel}>
              סגור עורך
            </button>
          )}
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label>
            הוסף מהקטalog
            <select value={servicePick} onChange={(event) => setServicePick(event.target.value)}>
              <option value="">בחר שירות...</option>
              {activeServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.price != null ? ` · ₪${service.price.toLocaleString("he-IL")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary !w-auto" onClick={addServiceLine} disabled={!servicePick}>
            <Plus className="h-4 w-4" />
            הוסף שירות
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
          <table className="w-full min-w-[640px] text-right text-sm">
            <thead className="bg-surface-card">
              <tr>
                <th className="p-3">תיאור</th>
                <th className="p-3 w-24">כמות</th>
                <th className="p-3 w-32">מחיר יח׳</th>
                <th className="p-3 w-28">סה״כ</th>
                <th className="p-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-t border-[var(--border-subtle)]">
                  <td className="p-2">
                    <input
                      value={line.description}
                      onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      placeholder="תיאור השורה"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={line.unitPrice || ""}
                      onChange={(event) => updateLine(line.key, { unitPrice: Number(event.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-ink-secondary">{formatIls(line.quantity * line.unitPrice)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="btn btn-secondary !w-auto !min-w-0 px-2"
                      onClick={() => removeLine(line.key)}
                      aria-label="הסר שורה"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="btn btn-secondary mt-3 !w-auto" onClick={addFreeLine}>
          <Plus className="h-4 w-4" />
          שורה חופשית
        </button>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label>
            תוקף עד
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          </label>
          <label className="md:col-span-2">
            הערות ללקוח
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="תוקף ההצעה 30 יום..."
              rows={2}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
          <div>
            <div className="text-sm text-ink-secondary">סה״כ (כולל מע״מ)</div>
            <strong className="text-2xl text-ink-primary">{formatIls(total)}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary !w-auto" onClick={openPreview}>
              <Eye className="h-4 w-4" />
              תצוגה מקדימה
            </button>
            <button type="button" className="btn !w-auto" onClick={() => void saveDraft()} disabled={saving}>
              {saving ? "שומר..." : "שמור טיוטה"}
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>

      {previewOpen && (
        <QuotePreview
          deal={deal}
          lines={lines}
          total={total}
          validUntil={validUntil}
          notes={notes}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
