"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { getReliabilityStatus, isAuthError, type ReliabilityStatusResponse } from "@/lib/api";
import { useI18n } from "@/i18n";

export default function ReliabilityPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<ReliabilityStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await getReliabilityStatus();
      setData(payload);
    } catch (err) {
      if (isAuthError(err)) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : t("reliability.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(
    () => data?.jobRuns.counts ?? { running: 0, completed: 0, failed: 0, timeout: 0 },
    [data]
  );

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="page-kicker">{t("reliability.title")}</div>
          <h1>{t("reliability.subtitle")}</h1>
        </div>
        <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
          {t("reliability.refresh")}
        </button>
      </div>

      {loading && <p>{t("reliability.loading")}</p>}
      {error && <div className="toast border-red-400/30 text-red-200">{error}</div>}

      {data && !loading && (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <InfoCard title={t("reliability.healthTitle")}>
              <InfoRow label={t("reliability.healthStatus")} value={data.health.status} />
              <InfoRow label={t("reliability.databaseStatus")} value={data.health.database} />
              <InfoRow label={t("reliability.commit")} value={data.health.commit ?? t("reliability.unknown")} mono />
              <InfoRow label={t("reliability.serverStartedAt")} value={formatDateTime(data.health.serverStartedAt)} />
              <InfoRow label={t("reliability.instanceId")} value={data.health.instanceId ?? t("reliability.unknown")} mono />
            </InfoCard>
            <InfoCard title={t("reliability.gmailSummaryTitle")}>
              <InfoRow label={t("reliability.gmailRunning")} value={String(data.gmailScans.running)} />
              <InfoRow label={t("reliability.gmailStuck")} value={String(data.gmailScans.stuck)} />
            </InfoCard>
          </section>

          <section className="mb-6">
            <h2 className="mb-3 text-xl font-bold">{t("reliability.jobRunTitle")}</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label={t("reliability.running")} value={counts.running} />
              <MetricCard label={t("reliability.completed")} value={counts.completed} />
              <MetricCard label={t("reliability.failed")} value={counts.failed} />
              <MetricCard label={t("reliability.timeout")} value={counts.timeout} />
            </div>
          </section>

          <section className="card mb-6">
            <h2 className="mb-3 text-xl font-bold">{t("reliability.recentFailuresTitle")}</h2>
            {data.jobRuns.recentFailures.length === 0 ? (
              <p>{t("reliability.emptyFailures")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[900px] table-fixed">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-right">{t("reliability.tableJobType")}</th>
                      <th className="px-3 py-2 text-right">{t("reliability.tableStatus")}</th>
                      <th className="px-3 py-2 text-right">{t("reliability.tableReference")}</th>
                      <th className="px-3 py-2 text-right">{t("reliability.tableError")}</th>
                      <th className="px-3 py-2 text-right">{t("reliability.tableUpdatedAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobRuns.recentFailures.map((row) => (
                      <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="break-words px-3 py-2">{row.jobType}</td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="break-all px-3 py-2" dir="ltr">{row.referenceId ?? "—"}</td>
                        <td className="break-words px-3 py-2">{row.errorMessage ?? "—"}</td>
                        <td className="px-3 py-2">{formatDateTime(row.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-ink-secondary">{label}</span>
      <span className={mono ? "font-mono text-sm" : "font-semibold"}>{value}</span>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
