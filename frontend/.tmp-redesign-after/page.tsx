"use client";

import {
  Bell,
  CalendarDays,
  FileText,
  ListTodo,
  MailSearch,
  MessageCircle,
  PlusCircle,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { useI18n } from "@/i18n";
import { useDashboardHome } from "@/hooks/useDashboardHome";
import {
  AppShell,
  Button,
  MessageBanner,
  PageTitle,
  SkeletonCard,
} from "@/components/natalie-ui";

type KpiItem = {
  id: string;
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
};

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
  const revenueValue = d.snapshotMetrics.find((m) => m.id === "in")?.value ?? "—";
  const activeChats = d.whatsAppStats?.activeChats ?? 0;
  const alertCount = d.alerts.length;

  const kpis = useMemo<KpiItem[]>(
    () => [
      {
        id: "appointments",
        label: t("dashboardDesign.kpi.appointments"),
        value: String(todayMeetings),
        icon: CalendarDays,
        href: "/dashboard/calendar",
      },
      {
        id: "tasks",
        label: t("dashboardDesign.kpi.tasks"),
        value: String(openTasks),
        icon: ListTodo,
        href: "/tasks",
      },
      {
        id: "documents",
        label: t("dashboardDesign.kpi.documents"),
        value: String(pendingDocs),
        icon: FileText,
        href: "/dashboard/document-reviews",
      },
      {
        id: "revenue",
        label: t("dashboardDesign.kpi.revenue"),
        value: revenueValue,
        icon: TrendingUp,
        href: "/payments",
      },
      {
        id: "messages",
        label: t("dashboardDesign.kpi.messages"),
        value: String(activeChats),
        icon: Users,
        href: "/dashboard/crm",
      },
      {
        id: "notifications",
        label: t("dashboardDesign.kpi.notifications"),
        value: String(alertCount),
        icon: Bell,
        href: "/dashboard/settings",
      },
    ],
    [activeChats, alertCount, openTasks, pendingDocs, revenueValue, t, todayMeetings]
  );

  const activityItems = useMemo(() => {
    if (d.activityTimeline.length > 0) {
      return d.activityTimeline.slice(0, 8).map((item) => ({
        id: item.id,
        text: item.text,
        meta: new Date(item.occurredAt ?? Date.now()).toLocaleString(dir === "rtl" ? "he-IL" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
          day: "numeric",
          month: "short",
        }),
        href: undefined as string | undefined,
      }));
    }
    return d.yourDayItems.slice(0, 6).map((item) => ({
      id: item.id,
      text: item.text,
      meta: undefined as string | undefined,
      href: item.href,
    }));
  }, [d.activityTimeline, d.yourDayItems, dir]);

  const quickAccess = useMemo(
    () => [
      {
        id: "scan",
        label: t("dashboardDesign.actions.scan"),
        icon: MailSearch,
        onClick: () => void d.runSync(),
        disabled: d.syncing,
      },
      {
        id: "upload",
        label: t("dashboardDesign.actions.upload"),
        icon: FileText,
        onClick: () => d.router.push("/camera"),
      },
      {
        id: "task",
        label: t("dashboardDesign.actions.task"),
        icon: PlusCircle,
        onClick: () => d.router.push("/tasks"),
      },
    ],
    [d, t]
  );

  const bannerMessage = d.pageError || d.displayActionMessage || d.displayToast?.text;
  const greeting = d.morningGreeting.headline || t("dashboardDesign.heroTitle");

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={
          <PageTitle
            title={d.businessName || t("dashboardDesign.title")}
            subtitle={t("dashboardDesign.subtitle")}
          />
        }
      >
        {bannerMessage ? (
          <MessageBanner tone="error" className="mb-4">
            {bannerMessage}
          </MessageBanner>
        ) : null}

        {d.pageLoading ? (
          <DashboardSkeleton />
        ) : (
          <div className="grid gap-5 md:gap-6">
            {/* Section 1 — Hero */}
            <section
              aria-labelledby="dashboard-hero-heading"
              className="overflow-hidden rounded-3xl border border-[#d7e4ff] bg-[linear-gradient(148deg,#eef4ff_0%,#f8faff_52%,#ffffff_100%)] p-4 shadow-[0_18px_44px_rgba(29,91,255,0.10)] sm:p-5 md:p-6"
            >
              <div className="grid items-center gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] lg:gap-8">
                <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-1">
                  <div className="flex items-start gap-3 lg:block">
                    <NataliePortrait size="compact" showStatusDot className="shrink-0 lg:hidden" />
                    <div className="min-w-0 grid flex-1 gap-1.5 sm:gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-[#1d4ed8] sm:text-sm">
                        {t("dashboardDesign.hero.welcome")}
                      </p>
                      <h1
                        id="dashboard-hero-heading"
                        className="text-xl font-black leading-tight tracking-tight text-[#0f172a] sm:text-2xl lg:text-[2rem]"
                      >
                        {greeting}
                      </h1>
                      <p className="max-w-xl text-sm font-medium leading-relaxed text-[#475569] sm:text-base">
                        {t("dashboardDesign.hero.tagline")}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="primary"
                      onClick={() => d.handleNatalieConversation("מה חשוב לי היום?")}
                      className="!min-h-12 w-full text-base"
                    >
                      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                      {t("dashboardDesign.hero.talk")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => d.router.push("/dashboard/calendar")}
                      className="!min-h-12 w-full text-base"
                    >
                      <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
                      {t("dashboardDesign.hero.openCalendar")}
                    </Button>
                  </div>

                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label={t("dashboardDesign.quickActions")}
                  >
                    {quickAccess.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#dbe5f4] bg-white/90 px-3 py-2 text-xs font-bold text-[#334155] shadow-sm transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                      >
                        <action.icon className="h-4 w-4 shrink-0 text-[#1d4ed8]" aria-hidden />
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="order-2 hidden justify-center lg:flex lg:order-2 lg:justify-end">
                  <div className="w-full max-w-[200px] sm:max-w-[240px] lg:max-w-[280px]">
                    <NataliePortrait size="hero" showStatusDot className="mx-auto" />
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2 — Business Overview */}
            <section aria-labelledby="dashboard-kpi-heading">
              <div className="mb-3 flex items-end justify-between gap-2">
                <h2 id="dashboard-kpi-heading" className="text-base font-black text-[#0f172a] md:text-lg">
                  {t("dashboardDesign.sections.businessOverview")}
                </h2>
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {kpis.map((metric) => (
                  <li key={metric.id} className="min-h-[108px]">
                    <BusinessKpiCard
                      label={metric.label}
                      value={metric.value}
                      icon={metric.icon}
                      onClick={() => {
                        if (metric.onClick) {
                          metric.onClick();
                          return;
                        }
                        if (metric.href) d.router.push(metric.href);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>

            {/* Section 3 — Today's Activity */}
            <section
              aria-labelledby="dashboard-activity-heading"
              className="rounded-2xl border border-[#dbe5f4] bg-white p-4 shadow-sm md:p-5"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5" aria-hidden>
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <h2 id="dashboard-activity-heading" className="text-base font-black text-[#0f172a] md:text-lg">
                    {t("dashboardDesign.sections.todayActivity")}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => d.router.push("/reports")}
                  className="shrink-0 text-xs font-bold text-[#1d4ed8] transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:text-sm"
                >
                  {t("dashboardDesign.openReports")}
                </button>
              </div>

              {activityItems.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#dbe5f4] bg-[#f8faff] px-4 py-6 text-center text-sm font-medium text-[#64748b]">
                  {t("dashboardDesign.emptyActivity")}
                </p>
              ) : (
                <ul className="grid gap-2" role="list">
                  {activityItems.map((item) => (
                    <li key={item.id}>
                      <ActivityRow
                        text={item.text}
                        meta={item.meta}
                        onClick={item.href ? () => d.router.push(item.href!) : undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </AppShell>
    </div>
  );
}

function BusinessKpiCard({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full min-h-[108px] w-full flex-col rounded-2xl border border-[#dbe5f4] bg-white p-3 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:p-4"
      aria-label={`${label}: ${value}`}
    >
      <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#ecf2ff] text-[#1d4ed8]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-[#64748b] sm:text-xs">
        {label}
      </span>
      <span className="mt-auto pt-1 text-lg font-black leading-none text-[#0f172a] sm:text-xl">
        {value}
      </span>
    </button>
  );
}

function ActivityRow({
  text,
  meta,
  onClick,
}: {
  text: string;
  meta?: string;
  onClick?: () => void;
}) {
  const className =
    "flex w-full items-start gap-3 rounded-xl border border-[#e6ecf8] bg-[#f8faff] px-3 py-3 text-start transition sm:px-4";

  const content = (
    <>
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1d4ed8]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-[#1f2937]">{text}</span>
        {meta ? <span className="mt-1 block text-xs text-[#64748b]">{meta}</span> : null}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${className} hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5 md:gap-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="min-h-[280px] overflow-hidden rounded-3xl">
        <SkeletonCard />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="min-h-[108px]">
            <SkeletonCard />
          </div>
        ))}
      </div>
      <SkeletonCard />
    </div>
  );
}
