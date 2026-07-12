"use client";

import { CalendarDays, FileClock, FileText, ListTodo, MailSearch, MessageCircle, PlusCircle, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { AdminLeadsCard } from "@/components/admin/AdminLeadsCard";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { useI18n } from "@/i18n";
import { useDashboardHome } from "@/hooks/useDashboardHome";
import {
  AppShell,
  Button,
  Card,
  FloatingActionButton,
  KpiCard,
  MessageBanner,
  PageTitle,
  SkeletonCard,
  SkeletonText,
  Timeline,
} from "@/components/natalie-ui";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

export default function DashboardPage() {
  const d = useDashboardHome();
  const { t, dir } = useI18n();

  const todayMeetings = useMemo(() => {
    const now = new Date();
    return d.upcomingAppointments.filter((appointment) => {
      const date = new Date(appointment.startTime);
      return (
        date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      );
    }).length;
  }, [d.upcomingAppointments]);

  const openTasks = useMemo(
    () => d.recentTasks.filter((task) => task.status !== "completed" && task.status !== "done").length,
    [d.recentTasks]
  );
  const pendingDocs = d.documentReviews.length;

  const heroSummary = useMemo(() => {
    if (pendingDocs > 0) return t("dashboardDesign.summary.pendingDocs", { count: pendingDocs });
    if (openTasks > 0) return t("dashboardDesign.summary.openTasks", { count: openTasks });
    if (todayMeetings > 0) return t("dashboardDesign.summary.meetings", { count: todayMeetings });
    return t("dashboardDesign.summary.allClear");
  }, [openTasks, pendingDocs, t, todayMeetings]);

  const kpis = useMemo(
    () => [
      { id: "income", label: t("dashboardDesign.kpi.income"), value: d.snapshotMetrics[0]?.value ?? "—" },
      { id: "expense", label: t("dashboardDesign.kpi.expense"), value: d.snapshotMetrics[1]?.value ?? "—" },
      { id: "docs", label: t("dashboardDesign.kpi.documents"), value: d.pageLoading ? "—" : String(pendingDocs) },
      { id: "meetings", label: t("dashboardDesign.kpi.meetings"), value: d.pageLoading ? "—" : String(todayMeetings) },
    ],
    [d.snapshotMetrics, d.pageLoading, pendingDocs, t, todayMeetings]
  );

  const quickActions = useMemo(
    () => [
      {
        id: "talk",
        label: t("dashboardDesign.actions.talk"),
        hint: t("dashboardDesign.actions.talkHint"),
        icon: MessageCircle,
        onClick: () => d.handleNatalieConversation("מה חשוב לי היום?"),
      },
      {
        id: "scan",
        label: t("dashboardDesign.actions.scan"),
        hint: t("dashboardDesign.actions.scanHint"),
        icon: MailSearch,
        onClick: () => void d.runSync(),
        disabled: d.syncing,
      },
      {
        id: "upload",
        label: t("dashboardDesign.actions.upload"),
        hint: t("dashboardDesign.actions.uploadHint"),
        icon: FileText,
        onClick: () => d.router.push("/camera"),
      },
      {
        id: "appointment",
        label: t("dashboardDesign.actions.appointment"),
        hint: t("dashboardDesign.actions.appointmentHint"),
        icon: CalendarDays,
        onClick: () => d.router.push("/dashboard/calendar"),
      },
      {
        id: "task",
        label: t("dashboardDesign.actions.task"),
        hint: t("dashboardDesign.actions.taskHint"),
        icon: PlusCircle,
        onClick: () => d.router.push("/tasks"),
      },
    ],
    [d, t]
  );

  const bannerMessage = d.pageError || d.displayActionMessage || d.displayToast?.text;

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={
          <PageTitle
            title={d.businessName || t("dashboardDesign.title")}
            subtitle={t("dashboardDesign.subtitle")}
          />
        }
        floatingButton={
          <FloatingActionButton
            label={t("dashboardDesign.floatingNatalie")}
            onClick={() => openNatalieAssistant()}
          />
        }
      >
        {bannerMessage ? (
          <MessageBanner tone="error" className="mb-4">
            {bannerMessage}
          </MessageBanner>
        ) : null}

        {/* לידים שיווקיים — נראה רק לאדמין הפלטפורמה (self-hiding) */}
        <div className="mb-4">
          <AdminLeadsCard />
        </div>

        {/* אין יותר Skeleton מלא-מסך: ה-Hero, ה-CTA וה-KPI נפתחים מיד; רק
            אזורי הנתונים שעדיין בטעינה מציגים loading מקומי משלהם. */}
        <div className="grid gap-4">
            <Card className="overflow-hidden border-[#d7e4ff] bg-[linear-gradient(145deg,#eef4ff_0%,#f7faff_55%,#ffffff_100%)] p-4 shadow-[0_16px_40px_rgba(29,91,255,0.11)] dark:border-[#1F2A44] dark:bg-[linear-gradient(145deg,#0F1B38_0%,#0D1730_55%,#0B1220_100%)] dark:shadow-[0_16px_40px_rgba(2,6,23,0.5)] md:p-6">
              <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="order-2 grid gap-4 lg:order-1">
                  <div className="grid gap-2">
                    <p className="inline-flex w-fit items-center gap-2 rounded-full border border-[#cbdcff] bg-white px-3 py-1 text-xs font-bold text-[#1d4ed8] dark:border-[#27395F] dark:bg-[#0F1E42] dark:text-[#93C5FD]">
                      <Sparkles className="h-3.5 w-3.5" />
                      {t("dashboardDesign.hero.badge")}
                    </p>
                    <h2 className="text-2xl font-black tracking-tight text-[#0f172a] dark:text-[#F1F5F9] md:text-3xl">
                      {d.morningGreeting.headline || t("dashboardDesign.heroTitle")}
                    </h2>
                    <p className="text-sm font-semibold text-[#475569] dark:text-[#94A3B8] md:text-base">
                      {t("dashboardDesign.hero.prepared")}
                    </p>
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-[#dbe6ff] bg-white/90 p-3 dark:border-[#1F2A44] dark:bg-[#0F172A]/90">
                    {d.pageLoading ? (
                      <SkeletonText lines={3} />
                    ) : (
                      <>
                        <HeroLine icon={CalendarDays} text={t("dashboardDesign.hero.meetings", { count: todayMeetings })} />
                        <HeroLine icon={FileClock} text={t("dashboardDesign.hero.documents", { count: pendingDocs })} />
                        <HeroLine icon={ListTodo} text={t("dashboardDesign.hero.tasks", { count: openTasks })} />
                      </>
                    )}
                  </div>

                  {d.pageLoading ? (
                    <div className="rounded-xl border border-[#e5ebfb] bg-white px-3 py-2 dark:border-[#1F2A44] dark:bg-[#0F172A]">
                      <SkeletonText lines={1} />
                    </div>
                  ) : (
                    <p className="rounded-xl border border-[#e5ebfb] bg-white px-3 py-2 text-sm font-semibold text-[#334155] dark:border-[#1F2A44] dark:bg-[#0F172A] dark:text-[#CBD5E1]">
                      {heroSummary}
                    </p>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="primary"
                      onClick={() => d.handleNatalieConversation("מה חשוב לי היום?")}
                      className="!min-h-12 text-base"
                    >
                      <MessageCircle className="h-4 w-4" />
                      {t("dashboardDesign.hero.talk")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => d.router.push("/dashboard/calendar")}
                      className="!min-h-12 text-base"
                    >
                      <CalendarDays className="h-4 w-4" />
                      {t("dashboardDesign.hero.openCalendar")}
                    </Button>
                  </div>
                </div>

                <div className="order-1 mx-auto w-[200px] sm:w-[230px] lg:order-2 lg:w-[240px]">
                  <NataliePortrait size="hero" showStatusDot />
                </div>
              </div>
            </Card>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {kpis.map((metric) => (
                <KpiCard key={metric.id} label={metric.label} value={metric.value} />
              ))}
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  disabled={action.disabled}
                  className="group rounded-2xl border border-[#dbe5f4] bg-white p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#1F2A44] dark:bg-[#111827]"
                  aria-label={action.label}
                >
                  <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#ecf2ff] text-[#1d4ed8] dark:bg-[#1E293B] dark:text-[#93C5FD]">
                    <action.icon className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-black text-[#0f172a] dark:text-[#F1F5F9] md:text-base">{action.label}</p>
                  <p className="mt-1 text-xs font-medium text-[#64748b] dark:text-[#94A3B8] md:text-sm">{action.hint}</p>
                </button>
              ))}
            </section>

            {d.pageLoading ? (
              <div className="grid gap-4" aria-busy="true">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
                <SkeletonCard />
              </div>
            ) : (
              <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Timeline
                title={t("dashboardDesign.todayTimeline")}
                emptyText={t("dashboardDesign.emptyToday")}
                items={d.yourDayItems.map((item) => ({
                  id: item.id,
                  text: item.text,
                  href: item.href,
                  urgency: item.urgency,
                }))}
                onSelect={(href) => {
                  if (href) d.router.push(href);
                }}
              />

              <Card className="p-4">
                <h2 className="text-base font-black text-[#0f172a] dark:text-[#F1F5F9]">{t("dashboardDesign.pending.title")}</h2>
                <div className="mt-3 grid gap-2">
                  <OverviewRow label={t("dashboardDesign.pending.tasks")} value={openTasks} />
                  <OverviewRow label={t("dashboardDesign.pending.documents")} value={pendingDocs} />
                  <OverviewRow label={t("dashboardDesign.pending.alerts")} value={d.alerts.length} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => d.router.push("/tasks")}>
                    {t("dashboardDesign.pending.openTasks")}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => d.router.push("/dashboard/document-reviews")}>
                    {t("dashboardDesign.pending.openDocuments")}
                  </Button>
                </div>
              </Card>
            </div>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-black text-[#0f172a] dark:text-[#F1F5F9]">{t("dashboardDesign.activityFeed")}</h2>
                <button
                  type="button"
                  onClick={() => d.router.push("/reports")}
                  className="text-xs font-bold text-[#1d4ed8] hover:underline"
                >
                  {t("dashboardDesign.openReports")}
                </button>
              </div>
              {d.activityTimeline.length === 0 ? (
                <p className="text-sm font-medium text-[#64748b]">{t("dashboardDesign.emptyActivity")}</p>
              ) : (
                <ul className="grid gap-2">
                  {d.activityTimeline.map((item) => (
                    <li key={item.id} className="rounded-xl border border-[#e6ecf8] bg-[#f8faff] px-3 py-2 dark:border-[#1F2A44] dark:bg-[#0F172A]">
                      <p className="text-sm font-semibold text-[#1f2937] dark:text-[#E2E8F0]">{item.text}</p>
                      <p className="mt-1 text-xs text-[#64748b] dark:text-[#94A3B8]">
                        {new Date(item.occurredAt ?? Date.now()).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
              </>
            )}
        </div>
      </AppShell>
    </div>
  );
}

function HeroLine({
  icon: Icon,
  text,
}: {
  icon: typeof CalendarDays;
  text: string;
}) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-[#334155] dark:text-[#CBD5E1]">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#ecf2ff] text-[#1d4ed8] dark:bg-[#1E293B] dark:text-[#93C5FD]">
        <Icon className="h-4 w-4" />
      </span>
      <span>{text}</span>
    </p>
  );
}

function OverviewRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 dark:border-[#1F2A44] dark:bg-[#0F172A]">
      <span className="text-sm font-semibold text-[#334155] dark:text-[#CBD5E1]">{label}</span>
      <span className="text-base font-black text-[#0f172a] dark:text-[#F1F5F9]">{value}</span>
    </div>
  );
}
