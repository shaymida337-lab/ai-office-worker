"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, StatusBadge } from "@/components/natalie-ui";
import { apiFetch } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import type { GmailScanResult, ScanProgressResult } from "@/lib/dashboard/homePageTypes";
import {
  HISTORICAL_SCAN_UI_POLL_INTERVAL_MS,
  HISTORICAL_SCAN_UI_POLL_MAX_ATTEMPTS,
} from "@/lib/dashboard/scanPollLimits";
import {
  historicalScanLiveProgressMessage,
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
 * Always renders (including after errors). Persists via PATCH, then starts + polls POST /api/gmail/scan.
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
  const pollAbortRef = useRef<AbortController | null>(null);
  const activeScanIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  function setScanning(next: boolean) {
    setIsScanning(next);
    try {
      onScanningChange?.(next);
    } catch {
      /* parent callback must never unmount this selector */
    }
  }

  function resetScanUi(options?: { keepErrorText?: string }) {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    activeScanIdRef.current = null;
    setSaving(false);
    setScanning(false);
    if (options?.keepErrorText) {
      setStatusTone("error");
      setStatusText(options.keepErrorText);
    } else {
      setStatusTone("info");
      setStatusText(null);
    }
  }

  async function cancelActiveHistoricalScan() {
    const scanId = activeScanIdRef.current;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    try {
      await apiFetch("/api/gmail/scan/cancel", {
        method: "POST",
        timeoutMs: 12_000,
        body: JSON.stringify(scanId ? { scanId } : {}),
      });
    } catch {
      /* UI reset still proceeds even if cancel API fails */
    }
    resetScanUi({
      keepErrorText: "הסריקה בוטלה. אפשר לבחור שוב או לרענן את הרשימה.",
    });
  }

  async function saveYears(years: HistoricalScanYears) {
    if (saving || isScanning) return;

    const previous = selected;
    let settingsSaved = false;
    pollAbortRef.current?.abort();
    const abort = new AbortController();
    pollAbortRef.current = abort;

    setSelected(years);
    setSaving(true);
    setScanning(true);
    setStatusTone("info");
    setStatusText(HISTORICAL_SCAN_IN_PROGRESS_MESSAGE);
    try {
      onToast?.({ text: HISTORICAL_SCAN_IN_PROGRESS_MESSAGE, tone: "info" });
    } catch {
      /* ignore toast errors */
    }

    try {
      const next = await apiFetch<OrganizationSettings>("/api/organization/settings", {
        method: "PATCH",
        body: JSON.stringify({ historicalScanYears: years }),
      });
      const savedYears = clampHistoricalScanYears(next.historicalScanYears);
      setSelected(savedYears);
      setOrganizationSettingsCache(next);
      settingsSaved = true;
      try {
        onSaved?.(next);
      } catch {
        /* ignore */
      }

      // Fire-and-forget accept (202 / started). Never block the UI on the worker.
      const scanResult = await apiFetch<GmailScanResult>("/api/gmail/scan", {
        method: "POST",
        timeoutMs: 12_000,
        body: JSON.stringify({
          historical: true,
          daysBack: savedYears * 365,
          years: savedYears,
          fullScan: true,
        }),
      });

      let documentsFound = summarizeOrgGmailScanResult(scanResult, 0).documentsFound;
      const jobId = scanResult.scanId ?? scanResult.jobId;
      if (!jobId) {
        throw new Error("הסריקה התחילה אך לא התקבל מזהה סריקה — רענן את הרשימה בעוד כמה דקות");
      }
      activeScanIdRef.current = jobId;

      setStatusText(historicalScanLiveProgressMessage(0, 0));

      const progress = await waitForOrgGmailScanProgress({
        scanId: jobId,
        intervalMs: HISTORICAL_SCAN_UI_POLL_INTERVAL_MS,
        maxAttempts: HISTORICAL_SCAN_UI_POLL_MAX_ATTEMPTS,
        signal: abort.signal,
        onProgress: (p: ScanProgressResult) => {
          const live = summarizeOrgGmailScanProgress(p, 0);
          setStatusTone("info");
          setStatusText(
            historicalScanLiveProgressMessage(p.emailsFetched ?? live.documentsFound, live.saved, {
              scanPhase: p.scanPhase ?? p.currentStage,
              totalMatched: p.totalMatched,
            })
          );
        },
        poll: (scanId) =>
          apiFetch<ScanProgressResult>(`/api/gmail/scan/status?scanId=${encodeURIComponent(scanId)}`),
      });
      documentsFound = summarizeOrgGmailScanProgress(progress, 0).documentsFound;

      if (abort.signal.aborted) return;

      try {
        await onScanComplete?.({ documentsFound });
      } catch {
        /* refresh failure should not hide the selector */
      }

      const doneText = historicalScanCompletedMessage(documentsFound);
      setStatusTone("success");
      setStatusText(doneText);
      try {
        onToast?.({ text: doneText, tone: "success" });
      } catch {
        /* ignore */
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      if (!settingsSaved) {
        setSelected(previous);
      }
      const errorText =
        err instanceof Error && err.message.trim()
          ? err.message
          : "הסריקה נכשלה. אפשר לנסות שוב או לבחור טווח אחר.";
      setStatusTone("error");
      setStatusText(errorText);
      try {
        onToast?.({ text: errorText, tone: "error" });
      } catch {
        /* ignore */
      }
    } finally {
      if (pollAbortRef.current === abort) {
        pollAbortRef.current = null;
      }
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
          כמה שנים אחורה לחפש מסמכים וחשבוניות בסריקה היסטורית של המייל. בחירה מפעילה סריקה מלאה ברקע.
        </p>
      </div>

      {/* Year buttons always stay mounted — never hide on error. */}
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
            <StatusBadge tone="info">{statusText ?? HISTORICAL_SCAN_IN_PROGRESS_MESSAGE}</StatusBadge>
          </span>
          <Button
            type="button"
            variant="secondary"
            className="min-h-8 px-3 text-xs"
            data-testid="historical-scan-selector-reset"
            onClick={() => void cancelActiveHistoricalScan()}
          >
            איפוס / ביטול
          </Button>
        </div>
      ) : null}

      {statusText && statusTone === "error" ? (
        <div
          role="alert"
          data-testid="historical-scan-selector-error"
          className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          {statusText}
        </div>
      ) : null}

      {statusText && statusTone === "success" && !isScanning ? (
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300" aria-live="polite">
          {statusText}
        </p>
      ) : null}

      {!isScanning && statusTone !== "error" && statusTone !== "success" ? (
        <p
          className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300"
          aria-live="polite"
        >
          נבחר: {yearLabel(selected)}
          {saving ? " · שומר…" : ""}
        </p>
      ) : null}

      {!isScanning && statusTone === "error" ? (
        <p className="text-sm font-semibold text-[var(--natalie-text-muted,#64748B)] dark:text-slate-300">
          נבחר: {yearLabel(selected)} · אפשר לנסות שוב
        </p>
      ) : null}
    </section>
  );
}
