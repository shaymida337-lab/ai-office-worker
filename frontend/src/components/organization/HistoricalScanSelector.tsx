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
  disabled?: boolean;
  onSaved?: (settings: OrganizationSettings) => void;
  onToast?: (toast: SettingsToast) => void;
};

/**
 * Historical Gmail scan depth (1–5 years).
 * Persists via PATCH /api/organization/settings, then starts POST /api/gmail/scan.
 */
export function HistoricalScanSelector({
  value,
  disabled = false,
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
    if (disabled || saving) return;
    if (years === selected) return;

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

      // After a successful depth save, kick off a full historical Gmail scan
      // for the selected window. Uses existing POST /api/gmail/scan (not /api/scan/start).
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
      className="grid gap-3 rounded-2xl border border-[#DBE5F4] bg-[#F8FAFF] p-4 dark:border-[#1F2A44] dark:bg-[#0F172A] md:p-5"
      aria-labelledby="historical-scan-selector-title"
    >
      <div>
        <h3 id="historical-scan-selector-title" className="text-base font-black text-[var(--natalie-text-primary,#0F172A)]">
          עומק סריקה היסטורית
        </h3>
        <p className="mt-1 text-sm font-semibold leading-6 text-[var(--natalie-text-muted,#64748B)]">
          כמה שנים אחורה לחפש מסמכים וחשבוניות בסריקה היסטורית של המייל. אפשר לשנות בכל רגע.
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
              disabled={disabled || saving}
              onClick={() => void saveYears(years)}
              className="min-w-[3.25rem]"
            >
              {years}
            </Button>
          );
        })}
      </div>

      <p className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]" aria-live="polite">
        נבחר: {yearLabel(selected)}
        {saving ? " · שומר…" : ""}
      </p>
    </section>
  );
}
