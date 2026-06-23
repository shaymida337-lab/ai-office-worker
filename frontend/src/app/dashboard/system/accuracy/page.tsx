"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Nav } from "@/components/Nav";
import { AccuracyMetricCard, AccuracySection } from "@/components/accuracy/AccuracyMetricCard";
import { apiFetch } from "@/lib/api";
import {
  formatConfidence,
  formatCountWithPercent,
  formatDurationMs,
  formatIlsAmount,
  formatPercent,
  toneForCount,
  toneForHighIsBad,
  toneForHighIsGood,
} from "@/lib/accuracyAnalyticsFormat";
import { colors } from "@/lib/design-tokens";
import type { AccuracyAnalyticsResponse } from "@/types/accuracyAnalytics";

const ACCURACY_API_PATH = "/api/internal/analytics/accuracy?days=30&source=all";
const AUTO_REFRESH_MS = 60_000;

export default function AccuracyDashboardPage() {
  const [data, setData] = useState<AccuracyAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError("");
    try {
      const response = await apiFetch<AccuracyAnalyticsResponse>(ACCURACY_API_PATH, {
        timeoutMs: 30000,
      });
      setData(response);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת לוח דיוק נכשלה");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const rangeLabel =
    data?.dateRange != null
      ? `${new Date(data.dateRange.from).toLocaleDateString("he-IL")} – ${new Date(data.dateRange.to).toLocaleDateString("he-IL")}`
      : "30 ימים אחרונים";

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="page-kicker">מערכת · ניטור פנימי</div>
          <h1 className="flex items-center gap-2">
            <ShieldCheck className="h-7 w-7" style={{ color: colors.accent }} />
            לוח דיוק מסמכים
          </h1>
          <p style={{ color: colors.textSecondary }}>
            מדדי איכות read-only ממנועי ARC, SIR, FSE, Trust ו-Outcome — ללא חשיפת נתונים גולמיים.
          </p>
          <p className="mt-2 text-sm" style={{ color: colors.textMuted }}>
            טווח: {rangeLabel} · מקור: {data?.source === "gmail" ? "Gmail" : "כל המקורות"} · גרסה:{" "}
            {data?.version ?? "—"}
          </p>
          {lastUpdated ? (
            <p className="mt-1 text-xs" style={{ color: colors.textMuted }}>
              עודכן לאחרונה: {lastUpdated.toLocaleTimeString("he-IL")} · רענון אוטומטי כל 60 שניות
            </p>
          ) : null}
        </div>
        <button className="btn btn-secondary min-h-[44px]" onClick={() => void load()} disabled={loading}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "מרענן..." : "רענן נתונים"}
          </span>
        </button>
      </div>

      {error ? (
        <div
          className="mb-6 rounded-2xl border p-4"
          style={{
            borderColor: colors.dangerBorder,
            backgroundColor: colors.dangerBg,
            color: colors.dangerText,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="card">
          <p>טוען מדדי דיוק...</p>
        </div>
      ) : data ? (
        <>
          <AccuracySection title="מסמכים" description="התפלגות תוצאות Outcome על פני כל המסמכים בטווח.">
            <AccuracyMetricCard title="סה״כ מסמכים" value={data.documentCount.toLocaleString("he-IL")} />
            <AccuracyMetricCard
              title="נשמרו"
              value={formatCountWithPercent(data.outcome.savedCount, data.outcome.savedPercent)}
              tone={toneForHighIsGood(data.outcome.savedPercent)}
            />
            <AccuracyMetricCard
              title="דורשים בדיקה"
              value={formatCountWithPercent(data.outcome.reviewCount, data.outcome.reviewPercent)}
              tone={toneForHighIsBad(data.outcome.reviewPercent, 10, 25)}
            />
            <AccuracyMetricCard
              title="נחסמו"
              value={formatCountWithPercent(data.outcome.blockedCount, data.outcome.blockedPercent)}
              tone={toneForCount(data.outcome.blockedCount)}
            />
            <AccuracyMetricCard
              title="כפולים"
              value={formatCountWithPercent(data.outcome.duplicateCount, data.outcome.duplicatePercent)}
              tone={toneForCount(data.outcome.duplicateCount)}
            />
            <AccuracyMetricCard
              title="שגיאות"
              value={formatCountWithPercent(data.outcome.errorCount, data.outcome.errorPercent)}
              tone={toneForCount(data.outcome.errorCount)}
            />
            <AccuracyMetricCard
              title="לא פיננסי"
              value={formatCountWithPercent(data.outcome.notFinancialCount, data.outcome.notFinancialPercent)}
              tone={toneForHighIsBad(data.outcome.notFinancialPercent, 8, 20)}
            />
          </AccuracySection>

          <AccuracySection title="ספקים" description="יכולת זיהוי ופתרון שם ספק.">
            <AccuracyMetricCard
              title="שיעור פתרון ספק"
              value={formatPercent(data.supplier.supplierResolutionRate)}
              subtitle={`${data.supplier.supplierResolvedCount.toLocaleString("he-IL")} נפתרו`}
              tone={toneForHighIsGood(data.supplier.supplierResolutionRate)}
            />
            <AccuracyMetricCard
              title="ספקים לא ידועים"
              value={formatCountWithPercent(data.supplier.unknownSupplierCount, data.supplier.unknownSupplierPercent)}
              tone={toneForHighIsBad(data.supplier.unknownSupplierPercent, 5, 15)}
            />
          </AccuracySection>

          <AccuracySection title="סכומים" description="איכות חילוץ סכומים וחריגות.">
            <AccuracyMetricCard
              title="סכום אפס"
              value={formatCountWithPercent(data.amount.zeroAmountCount, data.amount.zeroAmountPercent)}
              tone={toneForHighIsBad(data.amount.zeroAmountPercent, 3, 10)}
            />
            <AccuracyMetricCard
              title="סכומים חשודים"
              value={formatCountWithPercent(data.amount.suspiciousAmountCount, data.amount.suspiciousAmountPercent)}
              tone={toneForHighIsBad(data.amount.suspiciousAmountPercent, 2, 8)}
            />
            <AccuracyMetricCard
              title="סכום ממוצע"
              value={formatIlsAmount(data.amount.averageAmount)}
              tone="neutral"
            />
          </AccuracySection>

          <AccuracySection title="אמון מנועים" description="ממוצעי confidence לפי מנוע.">
            <AccuracyMetricCard
              title="Trust ממוצע"
              value={formatConfidence(data.trust.averageTrustConfidence)}
              tone={toneForHighIsGood((data.trust.averageTrustConfidence ?? 0) * 100, 75, 60)}
            />
            <AccuracyMetricCard
              title="ARC"
              value={formatConfidence(data.trust.averageArcConfidence)}
              tone={toneForHighIsGood((data.trust.averageArcConfidence ?? 0) * 100, 75, 60)}
            />
            <AccuracyMetricCard
              title="SIR"
              value={formatConfidence(data.trust.averageSirConfidence)}
              tone={toneForHighIsGood((data.trust.averageSirConfidence ?? 0) * 100, 75, 60)}
            />
            <AccuracyMetricCard
              title="FSE"
              value={formatConfidence(data.trust.averageFseTrust)}
              tone={toneForHighIsGood((data.trust.averageFseTrust ?? 0) * 100, 75, 60)}
            />
          </AccuracySection>

          <AccuracySection title="ביצועים" description="זמני עיבוד ממוצעים (כשזמינים בנתונים).">
            <AccuracyMetricCard
              title="זמן עיבוד ממוצע"
              value={formatDurationMs(data.performance.averageProcessingMs)}
              tone="neutral"
            />
            <AccuracyMetricCard
              title="זמן AI"
              value={formatDurationMs(data.performance.averageAiMs)}
              tone="neutral"
            />
            <AccuracyMetricCard
              title="זמן OCR"
              value={formatDurationMs(data.performance.averageOcrMs)}
              tone="neutral"
            />
          </AccuracySection>

          <AccuracySection title="Golden Dataset" description="שיעורי הצלחה ממערכת Golden (אם קיימים).">
            <AccuracyMetricCard
              title="שיעור הצלחה"
              value={data.golden.goldenPassRate == null ? "—" : formatPercent(data.golden.goldenPassRate)}
              subtitle={
                data.golden.goldenTotal > 0
                  ? `${data.golden.goldenPassed}/${data.golden.goldenTotal} עברו`
                  : "אין הרצות Golden זמינות"
              }
              tone={
                data.golden.goldenPassRate == null
                  ? "neutral"
                  : toneForHighIsGood(data.golden.goldenPassRate, 85, 70)
              }
            />
            <AccuracyMetricCard
              title="שיעור כשלון"
              value={data.golden.goldenFailRate == null ? "—" : formatPercent(data.golden.goldenFailRate)}
              subtitle={
                data.golden.goldenTotal > 0
                  ? `${data.golden.goldenFailed} נכשלו`
                  : "אין הרצות Golden זמינות"
              }
              tone={
                data.golden.goldenFailRate == null
                  ? "neutral"
                  : toneForHighIsBad(data.golden.goldenFailRate, 5, 15)
              }
            />
          </AccuracySection>
        </>
      ) : null}
    </div>
  );
}
