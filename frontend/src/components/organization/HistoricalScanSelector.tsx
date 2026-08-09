"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, StatusBadge } from "@/components/natalie-ui";
import { apiFetch } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import type { GmailScanResult, ScanProgressResult } from "@/lib/dashboard/homePageTypes";
import { GMAIL_SCAN_POLL_INTERVAL_MS, MAX_GMAIL_SCAN_POLL_ATTEMPTS } from "@/lib/dashboard/scanPollLimits";
import {
  summarizeOrgGmailScanProgress,
  summarizeOrgGmailScanResult,
  waitForOrgGmailScanProgress,
} from "@/lib/invoices/gmailOrgScan";
import { setOrganizationSettingsCache } from "@/lib/organization/organizationSettingsStore";

export const HISTORICAL_SCAN_YEAR_OPTIONS = [1, 2, 3, 4, 5] as const;
export type HistoricalScanYears = (typeof HISTORICAL_SCAN_YEAR_OPTIONS)[number];

export type SettingsToast = { text: string; tone: "success" | "error" | "info" };

export const HISTORICAL_SCAN_IN_PROGRESS_MESSAGE = "סורק את Gmail כעת... אנא המתן";

export function historicalScanCompletedMessage(documentsFound: number): string {
  return `הסריקה הושלמה! נמצאו ${documentsFound} מסמכים`;
}

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
  /** Fired when a historical scan finishes successfully — refresh invoices list. */
  onScanComplete?: (result: { documentsFound: number }) => void | Promise<void>;
  /** Lets the parent disable other scan actions while this selector is scanning. */
  onScanningChange?: (scanning: boolean) => void;
};

/**
 * Historical Gmail scan depth (1–5 years).
 * Always renders. Persists via PATCH, then starts + polls POST /api/gmail/scan.
 */
export function HistoricalScanSelector({
  value,
  onSaved,
  onToast,
  onScanComplete,
  onScanningChange,
}: HistoricalScanSelectorProps) {
  const [selected, setSelected] = useState<HistoricalScanYears>(() => clampHistoricalScanYears(value));
  const [saving, setSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  useEffect(() => {
    if (saving || isScanning) return;
    if (value === undefined || value === null) return;
    setSelected(clampHistoricalScanYears(value));
  }, [value, saving, isScanning]);

  useEffect(() => {
    if (statusTone !== "success" || !statusText) return;
    const timer = window.setTimeout(() => setStatusText(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [statusTone, statusText]);

  function setScanning(next: boolean) {
    setIsScanning(next);
    onScanningChange?.(next);
  }

  async function saveYears(years: HistoricalScanYears) {
    if (saving || isScanning) return;

    const previous = selected;
    setSelected(years);
    setSaving(true);
    setScanning(true);
    setStatusTone("info");
    setStatusText(HISTORICAL_SCAN_IN_PROGRESS_MESSAGE);
    onToast?.({ text: HISTORICAL_SCAN_IN_PROGRESS_MESSAGE, tone: "info" });

    try {
      const next = await apiFetch<OrganizationSettings>("/api/organization/settings", {
        method: "PATCH",
        body: JSON.stringify({ historicalScanYears: years }),
      });
      const savedYears = clampHistoricalScanYears(next.historicalScanYears);
      setSelected(savedYears);
      setOrganizationSettingsCache(next);
      onSaved?.(next);

      const scanResult = await apiFetch<GmailScanResult>("/api/gmail/scan", {
        method: "POST",
        body: JSON.stringify({
          historical: true,
          daysBack: savedYears * 365,
          years: savedYears,
          fullScan: true,
        }),
      });

      let documentsFound = summarizeOrgGmailScanResult(scanResult, 0).documentsFound;
      if (scanResult.scanId) {
        const progress = await waitForOrgGmailScanProgress({
          scanId: scanResult.scanId,
          intervalMs: GMAIL_SCAN_POLL_INTERVAL_MS,
          maxAttempts: MAX_GMAIL_SCAN_POLL_ATTEMPTS,
          poll: (scanId) => apiFetch<ScanProgressResult>(`/api/gmail/scan/${scanId}`),
        });
        documentsFound = summarizeOrgGmailScanProgress(progress, 0).documentsFound;
      }

      await onScanComplete?.({ documentsFound });

      const doneText = historicalScanCompletedMessage(documentsFound);
      setStatusTone("success");
      setStatusText(doneText);
      onToast?.({ text: doneText, tone: "success" });
    } catch (err) {
      setSelected(previous);
      const errorText = err instanceof Error ? err.message : "עדכון עומק הסריקה נכשל";
      setStatusTone("error");
      setStatusText(errorText);
      onToast?.({ text: errorText, tone: "error" });
    } finally {
      setSaving(false);
      setScanning(false);
    }
  }

  const busy = saving || isScanning;

  return (
    <section
      data-testid="historical-scan-selector"
      className="grid gap-3 rounded-2xl border-2 border-[#93C5FD] bg-[#EFF6FF] p-4 shadow-sm dark:border-[#1D4ED8] dark:bg-[#0F172A] md:p-5"
      aria-labelledby="historical-scan-selector-title"
      aria-busy={busy}
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
              disabled={busy}
              onClick={() => void saveYears(years)}
              className="min-w-[3.25rem]"
            >
              {years}
            </Button>
          );
        })}
      </div>

      {isScanning ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="historical-scan-selector-scanning"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin text-[#2563EB]" aria-hidden />
          <span className="inline-flex animate-pulse">
            <StatusBadge tone="info">{HISTORICAL_SCAN_IN_PROGRESS_MESSAGE}</StatusBadge>
          </span>
        </div>
      ) : null}

      {statusText && !isScanning ? (
        <p
          className={`text-sm font-semibold ${
            statusTone === "error"
              ? "text-red-600 dark:text-red-300"
              : statusTone === "success"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300"
          }`}
          aria-live="polite"
        >
          {statusText}
        </p>
      ) : (
        <p
          className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300"
          aria-live="polite"
        >
          נבחר: {yearLabel(selected)}
          {saving ? " · שומר…" : ""}
        </p>
      )}
    </section>
  );
}
