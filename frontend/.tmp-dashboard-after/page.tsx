"use client";

import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronLeft,
  FileText,
  LayoutGrid,
  ListTodo,
  MailSearch,
  MessageCircle,
  Receipt,
  Settings,
  TrendingUp,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { useI18n } from "@/i18n";
import { useDashboardHome } from "@/hooks/useDashboardHome";
import {
  AppShell,
  MessageBanner,
  PageTitle,
  SkeletonCard,
} from "@/components/natalie-ui";

type MetricTone = "featured" | "default" | "alert";

type AttentionItem = {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel: string;
  href?: string;
  onClick?: () => void;
  tone: "urgent" | "warn" | "calm";
};

type ModuleLink = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
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
  const expenseValue = d.snapshotMetrics.find((m) => m.id === "out")?.value ?? "—";
  const alertCount = d.alerts.length;
  const attentionTotal = pendingDocs + openTasks + alertCount;

  const natalieStatusLine = useMemo(() => {
    const worked = d.alreadyWorkedSummary.items[0]?.text;
    if (worked) return worked;
    return d.morningGreeting.leadIn || t("dashboardDesign.hero.tagline");
  }, [d.alreadyWorkedSummary.items, d.morningGreeting.leadIn, t]);

  const natalieInsight = useMemo(() => {
    if (pendingDocs > 0) return t("dashboardDesign.summary.pendingDocs", { count: pendingDocs });
    if (openTasks > 0) return t("dashboardDesign.summary.openTasks", { count: openTasks });
    if (todayMeetings > 0) return t("dashboardDesign.summary.meetings", { count: todayMeetings });
    return t("dashboardDesign.summary.allClear");
  }, [openTasks, pendingDocs, t, todayMeetings]);

  const featuredMetric = useMemo(() => {
    if (attentionTotal > 0) {
      return {
        id: "attention",
        label: t("dashboardDesign.metrics.featuredAttention"),
        value: String(attentionTotal),
        hint: t("dashboardDesign.metrics.featuredAttentionHint"),
        tone: "alert" as MetricTone,
        href:
          pendingDocs > 0
            ? "/dashboard/document-reviews"
            : openTasks > 0
              ? "/tasks"
              : "/dashboard/settings",
      };
    }
    return {
      id: "revenue",
      label: t("dashboardDesign.metrics.featuredRevenue"),
      value: revenueValue,
      hint: t("dashboardDesign.metrics.featuredRevenueHint"),
      tone: "featured" as MetricTone,
      href: "/payments",
    };
  }, [attentionTotal, openTasks, pendingDocs, revenueValue, t]);

  const secondaryMetrics = useMemo(
    () => [
      {
        id: "meetings",
        label: t("dashboardDesign.kpi.appointments"),
        value: String(todayMeetings),
        icon: CalendarDays,
        href: "/dashboard/calendar",
      },
      {
        id: "documents",
        label: t("dashboardDesign.kpi.documents"),
        value: String(pendingDocs),
        icon: FileText,
        href: "/dashboard/document-reviews",
      },
      {
        id: "tasks",
        label: t("dashboardDesign.kpi.tasks"),
        value: String(openTasks),
        icon: ListTodo,
        href: "/tasks",
      },
    ],
    [openTasks, pendingDocs, t, todayMeetings]
  );

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    for (const item of d.yourDayItems.slice(0, 5)) {
      items.push({
        id: item.id,
        icon: item.urgency === "urgent" ? Bell : item.urgency === "warn" ? ListTodo : CalendarDays,
        title: item.text,
        description:
          item.urgency === "urgent"
            ? t("dashboardDesign.activity.urgentHint")
            : t("dashboardDesign.activity.followUpHint"),
        actionLabel: t("dashboardDesign.activity.open"),
        href: item.href ?? undefined,
        tone: item.urgency ?? "calm",
      });
    }

    for (const item of d.activityTimeline.slice(0, 4)) {
      if (items.some((existing) => existing.id === item.id)) continue;
      items.push({
        id: item.id,
        icon: FileText,
        title: item.text,
        description: new Date(item.occurredAt ?? Date.now()).toLocaleString(
          dir === "rtl" ? "he-IL" : "en-US",
          { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }
        ),
        actionLabel: t("dashboardDesign.openReports"),
        href: "/reports",
        tone: "calm",
      });
    }

    return items.slice(0, 6);
  }, [d.activityTimeline, d.yourDayItems, dir, t]);

  const moduleLinks = useMemo<ModuleLink[]>(
    () => [
      { id: "calendar", label: t("globalNav.calendar"), hint: t("dashboardDesign.modules.calendar"), icon: CalendarDays, href: "/dashboard/calendar" },
      { id: "customers", label: t("globalNav.customers"), hint: t("dashboardDesign.modules.customers"), icon: Users, href: "/dashboard/crm" },
      { id: "documents", label: t("globalNav.documents"), hint: t("dashboardDesign.modules.documents"), icon: FileText, href: "/dashboard/document-reviews" },
      { id: "tasks", label: t("globalNav.tasks"), hint: t("dashboardDesign.modules.tasks"), icon: ListTodo, href: "/tasks" },
      { id: "invoices", label: t("globalNav.invoices"), hint: t("dashboardDesign.modules.invoices"), icon: Receipt, href: "/dashboard/invoices" },
      { id: "payments", label: t("globalNav.payments"), hint: t("dashboardDesign.modules.payments"), icon: Wallet, href: "/payments" },
      { id: "reports", label: t("globalNav.reports"), hint: t("dashboardDesign.modules.reports"), icon: TrendingUp, href: "/reports" },
      { id: "settings", label: t("globalNav.settings"), hint: t("dashboardDesign.modules.settings"), icon: Settings, href: "/dashboard/settings" },
      {
        id: "integrations",
        label: t("globalNav.integrations"),
        hint: t("dashboardDesign.modules.integrations"),
        icon: LayoutGrid,
        href: "/dashboard/settings?tab=integrations",
      },
    ],
    [t]
  );

  const bannerMessage = d.pageError || d.displayActionMessage || d.displayToast?.text;
  const greeting = d.morningGreeting.headline || t("dashboardDesign.heroTitle");
  const ChevronIcon = dir === "rtl" ? ChevronLeft : ArrowLeft;

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
          <div className="grid gap-5 pb-2 md:gap-6">
            {/* —— Hero: Natalie-first, dark canvas —— */}
            <section
              aria-labelledby="dashboard-hero-heading"
              className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0B1224] via-[#152C6B] to-[#1E3A8A] px-4 pb-5 pt-4 text-white shadow-[0_24px_60px_rgba(11,18,36,0.35)] sm:px-6 sm:pb-6 sm:pt-5 md:px-8"
            >
              <div
                className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-[#60A5FA]/20 blur-3xl"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-24 start-8 h-48 w-48 rounded-full bg-[#818CF8]/15 blur-3xl"
                aria-hidden
              />

              <div className="relative grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-8">
                <div className="order-2 grid gap-4 lg:order-1">
                  <div className="grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#93C5FD]">
                      {t("dashboardDesign.hero.welcome")}
                    </p>
                    <h1
                      id="dashboard-hero-heading"
                      className="text-[1.65rem] font-black leading-[1.15] tracking-tight sm:text-3xl lg:text-[2.1rem]"
                    >
                      {greeting}
                    </h1>
                    <p className="max-w-xl text-sm leading-relaxed text-[#CBD5E1] sm:text-base">
                      {natalieStatusLine}
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => d.handleNatalieConversation("מה חשוב לי היום?")}
                      className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-white px-5 text-base font-black text-[#0F172A] shadow-[0_14px_40px_rgba(15,23,42,0.28)] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:max-w-md"
                    >
                      <MessageCircle className="h-5 w-5 shrink-0 text-[#1D4ED8]" aria-hidden />
                      {t("dashboardDesign.hero.talk")}
                    </button>
                    <button
                      type="button"
                      onClick={() => d.router.push("/dashboard/calendar")}
                      className="inline-flex w-fit items-center gap-1.5 px-1 py-1 text-sm font-semibold text-[#BFDBFE] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#BFDBFE]"
                    >
                      {t("dashboardDesign.hero.openCalendar")}
                      <ChevronIcon className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
                  <div className="relative">
                    <div
                      className="absolute inset-0 scale-110 rounded-[24px] bg-[#60A5FA]/25 blur-2xl"
                      aria-hidden
                    />
                    <div className="relative rounded-[24px] border border-white/20 bg-white/10 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                      <NataliePortrait size="heroDesktop" showStatusDot className="rounded-[20px]" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* —— Business summary: featured + secondary —— */}
            <section aria-labelledby="dashboard-metrics-heading" className="grid gap-3">
              <h2 id="dashboard-metrics-heading" className="text-sm font-bold uppercase tracking-wide text-[#64748B]">
                {t("dashboardDesign.sections.businessOverview")}
              </h2>

              <div className="grid gap-3 lg:grid-cols-12">
                <FeaturedMetricCard
                  label={featuredMetric.label}
                  value={featuredMetric.value}
                  hint={featuredMetric.hint}
                  tone={featuredMetric.tone}
                  onClick={() => d.router.push(featuredMetric.href)}
                  className="lg:col-span-7"
                />

                <ul className="grid gap-2 sm:grid-cols-3 lg:col-span-5 lg:grid-cols-1">
                  {secondaryMetrics.map((metric) => (
                    <li key={metric.id}>
                      <SecondaryMetricCard
                        label={metric.label}
                        value={metric.value}
                        icon={metric.icon}
                        onClick={() => d.router.push(metric.href)}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              {alertCount > 0 ? (
                <button
                  type="button"
                  onClick={() => d.router.push("/dashboard/settings")}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] px-4 py-3 text-start transition hover:bg-[#FEF3C7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D97706]"
                >
                  <span className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#FEF3C7] text-[#B45309]">
                      <Bell className="h-4 w-4" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-black text-[#92400E]">
                        {t("dashboardDesign.metrics.alertTitle", { count: alertCount })}
                      </span>
                      <span className="block text-xs font-medium text-[#B45309]">
                        {t("dashboardDesign.metrics.alertHint")}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm font-bold text-[#B45309]">{t("dashboardDesign.activity.open")}</span>
                </button>
              ) : null}

              {expenseValue !== "—" ? (
                <p className="text-xs font-medium text-[#64748B]">
                  {t("dashboardDesign.metrics.expenseFootnote", { value: expenseValue })}
                </p>
              ) : null}

              <div className="flex items-start gap-3 rounded-2xl border border-[#DBEAFE] bg-[#F8FAFF] px-4 py-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1D4ED8] text-xs font-black text-white" aria-hidden>
                  {t("dashboardDesign.hero.badge").charAt(0)}
                </span>
                <p className="text-sm font-medium leading-relaxed text-[#334155]">{natalieInsight}</p>
              </div>
            </section>

            {/* —— Attention list —— */}
            <section
              aria-labelledby="dashboard-attention-heading"
              className="rounded-[24px] border border-[#E2E8F0] bg-white p-4 shadow-sm md:p-5"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="dashboard-attention-heading" className="text-lg font-black text-[#0F172A]">
                  {t("dashboardDesign.sections.needsAttention")}
                </h2>
                <button
                  type="button"
                  onClick={() => d.router.push("/reports")}
                  className="text-xs font-bold text-[#1D4ED8] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:text-sm"
                >
                  {t("dashboardDesign.activity.viewAll")}
                </button>
              </div>

              {attentionItems.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#DBE5F4] bg-[#F8FAFF] px-4 py-8 text-center text-sm font-medium text-[#64748B]">
                  {t("dashboardDesign.emptyToday")}
                </p>
              ) : (
                <ul className="grid gap-2" role="list">
                  {attentionItems.map((item) => (
                    <li key={item.id}>
                      <AttentionRow
                        item={item}
                        onAction={() => {
                          if (item.onClick) {
                            item.onClick();
                            return;
                          }
                          if (item.href) d.router.push(item.href);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* —— Module shortcuts —— */}
            <section aria-labelledby="dashboard-modules-heading" className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 id="dashboard-modules-heading" className="text-sm font-bold uppercase tracking-wide text-[#64748B]">
                  {t("dashboardDesign.sections.quickAccess")}
                </h2>
                <div className="flex items-center gap-1">
                  <ToolButton
                    label={t("dashboardDesign.actions.scan")}
                    icon={MailSearch}
                    onClick={() => void d.runSync()}
                    disabled={d.syncing}
                  />
                  <ToolButton
                    label={t("dashboardDesign.actions.upload")}
                    icon={Upload}
                    onClick={() => d.router.push("/camera")}
                  />
                  <ToolButton
                    label={t("dashboardDesign.actions.task")}
                    icon={ListTodo}
                    onClick={() => d.router.push("/tasks")}
                  />
                </div>
              </div>

              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
                {moduleLinks.map((mod) => (
                  <li key={mod.id}>
                    <ModuleTile
                      label={mod.label}
                      hint={mod.hint}
                      icon={mod.icon}
                      onClick={() => d.router.push(mod.href)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </AppShell>
    </div>
  );
}

function FeaturedMetricCard({
  label,
  value,
  hint,
  tone,
  onClick,
  className = "",
}: {
  label: string;
  value: string;
  hint: string;
  tone: MetricTone;
  onClick: () => void;
  className?: string;
}) {
  const isAlert = tone === "alert";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[148px] w-full flex-col justify-between rounded-[24px] border p-5 text-start transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] ${
        isAlert
          ? "border-[#FDE68A] bg-[#FFFBEB]"
          : "border-[#BFDBFE] bg-[#EFF6FF]"
      } ${className}`}
    >
      <span className={`text-xs font-bold uppercase tracking-wide ${isAlert ? "text-[#B45309]" : "text-[#1D4ED8]"}`}>
        {label}
      </span>
      <span className={`text-4xl font-black leading-none sm:text-5xl ${isAlert ? "text-[#92400E]" : "text-[#0F172A]"}`}>
        {value}
      </span>
      <span className={`text-sm font-medium ${isAlert ? "text-[#B45309]" : "text-[#475569]"}`}>{hint}</span>
    </button>
  );
}

function SecondaryMetricCard({
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
      className="flex w-full items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3 text-start transition hover:border-[#BFDBFE] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:px-4"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#1D4ED8] shadow-sm">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-[#64748B]">{label}</span>
        <span className="block text-xl font-black text-[#0F172A]">{value}</span>
      </span>
    </button>
  );
}

function AttentionRow({ item, onAction }: { item: AttentionItem; onAction: () => void }) {
  const toneStyles =
    item.tone === "urgent"
      ? "border-[#FECACA] bg-[#FEF2F2]"
      : item.tone === "warn"
        ? "border-[#FDE68A] bg-[#FFFBEB]"
        : "border-[#E2E8F0] bg-[#F8FAFC]";

  const iconStyles =
    item.tone === "urgent"
      ? "bg-[#FEE2E2] text-[#B91C1C]"
      : item.tone === "warn"
        ? "bg-[#FEF3C7] text-[#B45309]"
        : "bg-[#E0E7FF] text-[#1D4ED8]";

  return (
    <div className={`flex items-center gap-3 rounded-2xl border px-3 py-3 sm:px-4 ${toneStyles}`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconStyles}`}>
        <item.icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-[#0F172A]">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-xs font-medium text-[#64748B]">{item.description}</p>
        ) : null}
      </div>
      {(item.href || item.onClick) && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-xl border border-[#BFDBFE] bg-white px-3 py-2 text-xs font-bold text-[#1D4ED8] transition hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  );
}

function ModuleTile({
  label,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[80px] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-[#E2E8F0] bg-white px-1.5 py-2 text-center transition hover:border-[#BFDBFE] hover:bg-[#F8FAFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] sm:min-h-[88px]"
      aria-label={`${label} — ${hint}`}
    >
      <Icon className="h-4 w-4 text-[#1D4ED8]" aria-hidden />
      <span className="line-clamp-1 text-[10px] font-bold leading-tight text-[#334155] sm:text-[11px]">{label}</span>
      <span className="hidden line-clamp-1 text-[9px] font-medium text-[#94A3B8] sm:block">{hint}</span>
    </button>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#64748B] transition hover:border-[#BFDBFE] hover:text-[#1D4ED8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:opacity-50"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5 md:gap-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="min-h-[260px] overflow-hidden rounded-[28px]">
        <SkeletonCard />
      </div>
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="min-h-[148px] lg:col-span-7">
          <SkeletonCard />
        </div>
        <div className="grid gap-2 lg:col-span-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </div>
      <SkeletonCard />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {Array.from({ length: 9 }).map((_, index) => (
          <SkeletonCard key={`mod-${index}`} />
        ))}
      </div>
    </div>
  );
}
