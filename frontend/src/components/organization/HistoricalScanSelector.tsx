"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/natalie-ui";
import { apiFetch } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { setOrganizationSettingsCache } from "@/lib/organization/organizationSettingsStore";

export const HISTORICAL_SCAN_YEAR_OPTIONS = [1, 2, 3, 4, 5] as const;
export type HistoricalScanYears = (typeof HISTORICAL_SCAN_YEAR_OPTIONS)[number];

export type SettingsToast = { text: string; tone: "success" | "error" };

function clampHistoricalScanYears(value: number | null | undefined): HistoricalScanYears {
  const n = Math.trunc(Number(value ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 5) return 5;
  return n as HistoricalScanYears;
}

function yearLabel(years: number): string {
  return years === 1 ? "שנה אחת" : `${years} שנים`;
}

export function historicalScanDepthToast(years: number): string {
  return `עומק הסריקה עודכן ל־${yearLabel(years)}`;
}

type HistoricalScanSelectorProps = {
  value?: number | null;
  onSaved?: (settings: OrganizationSettings) => void;
  onToast?: (toast: SettingsToast) => void;
};

/**
 * Historical Gmail scan depth (1–5 years).
 * Always renders. Persists via PATCH, then starts POST /api/gmail/scan.
 */
export function HistoricalScanSelector({
  value,
  onSaved,
  onToast,
}: HistoricalScanSelectorProps) {
  const [selected, setSelected] = useState<HistoricalScanYears>(() => clampHistoricalScanYears(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saving) return;
    if (value === undefined || value === null) return;
    setSelected(clampHistoricalScanYears(value));
  }, [value, saving]);

  async function saveYears(years: HistoricalScanYears) {
    if (saving) return;

    const previous = selected;
    setSelected(years);
    setSaving(true);
    try {
      const next = await apiFetch<OrganizationSettings>("/api/organization/settings", {
        method: "PATCH",
        body: JSON.stringify({ historicalScanYears: years }),
      });
      const savedYears = clampHistoricalScanYears(next.historicalScanYears);
      setSelected(savedYears);
      setOrganizationSettingsCache(next);
      onSaved?.(next);
      onToast?.({ text: historicalScanDepthToast(savedYears), tone: "success" });

      try {
        await apiFetch("/api/gmail/scan", {
          method: "POST",
          body: JSON.stringify({
            historical: true,
            daysBack: savedYears * 365,
            years: savedYears,
            fullScan: true,
          }),
        });
      } catch {
        // Setting already saved; Gmail may be disconnected or a scan may already be running.
      }
    } catch (err) {
      setSelected(previous);
      onToast?.({
        text: err instanceof Error ? err.message : "עדכון עומק הסריקה נכשל",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-testid="historical-scan-selector"
      className="grid gap-3 rounded-2xl border-2 border-[#93C5FD] bg-[#EFF6FF] p-4 shadow-sm dark:border-[#1D4ED8] dark:bg-[#0F172A] md:p-5"
      aria-labelledby="historical-scan-selector-title"
    >
      <div>
        <h3
          id="historical-scan-selector-title"
          className="text-base font-black text-[var(--natalie-text-primary,#0F172A)] dark:text-white"
        >
          עומק סריקה היסטורית
        </h3>
        <p className="mt-1 text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300">
          כמה שנים אחורה לחפש מסמכים וחשבוניות בסריקה היסטורית של המייל. בחירה מפעילה סריקה מלאה מיד.
        </p>
      </div>

      <div role="radiogroup" aria-label="עומק סריקה היסטורית בשנים" className="flex flex-wrap gap-2">
        {HISTORICAL_SCAN_YEAR_OPTIONS.map((years) => {
          const active = selected === years;
          return (
            <Button
              key={years}
              type="button"
              role="radio"
              aria-checked={active}
              variant={active ? "primary" : "secondary"}
              disabled={saving}
              onClick={() => void saveYears(years)}
              className="min-w-[3.25rem]"
            >
              {years}
            </Button>
          );
        })}
      </div>

      <p
        className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300"
        aria-live="polite"
      >
        נבחר: {yearLabel(selected)}
        {saving ? " · שומר…" : ""}
      </p>
    </section>
  );
}
