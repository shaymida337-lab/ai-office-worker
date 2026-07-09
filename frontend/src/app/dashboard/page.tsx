"use client";

import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { useDashboardHome } from "@/hooks/useDashboardHome";
import {
  ActivityFeed,
  AppShell,
  BottomNavigation,
  DashboardKpiCard,
  FloatingNatalieButton,
  Header,
  NatalieHeroCard,
  QuickActions,
  TodayTimeline,
  WaitingForYouCard,
} from "@/components/dashboard/migrated";

export default function DashboardPage() {
  const d = useDashboardHome();
  const { t, dir } = useI18n();

  const quickActions = useMemo(
    () => [
      { id: "ask", label: t("dashboardDesign.actions.askNatalie"), onClick: () => d.handleNatalieConversation("מה חשוב לי היום?") },
      { id: "scan", label: t("dashboardDesign.actions.scanGmail"), onClick: () => void d.runSync(), disabled: d.syncing },
      { id: "upload", label: t("dashboardDesign.actions.uploadDocument"), onClick: () => d.router.push("/camera") },
    ],
    [d, t]
  );

  const bottomItems = useMemo(
    () => [
      { id: "home", label: t("dashboardDesign.nav.home"), href: "/dashboard" },
      { id: "invoices", label: t("dashboardDesign.nav.invoices"), href: "/dashboard/invoices" },
      { id: "payments", label: t("dashboardDesign.nav.payments"), href: "/payments" },
      { id: "calendar", label: t("dashboardDesign.nav.calendar"), href: "/dashboard/calendar" },
    ],
    [t]
  );

  return (
    <div dir={dir}>
      <AppShell
        header={
          <Header
            title={d.businessName || t("dashboardDesign.title")}
            subtitle={t("dashboardDesign.subtitle")}
            onRefresh={() => window.location.reload()}
            refreshLabel={t("dashboardDesign.refresh")}
          />
        }
        bottomNavigation={<BottomNavigation items={bottomItems} />}
        floatingButton={
          <FloatingNatalieButton
            label={t("dashboardDesign.floatingNatalie")}
            onClick={() => d.handleNatalieConversation("פתחי את עוזרת נטלי")}
          />
        }
      >
        {(d.pageError || d.displayActionMessage || d.displayToast) && (
          <section className="mb-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#7F1D1D]">
            {d.pageError || d.displayActionMessage || d.displayToast?.text}
          </section>
        )}

        <div className="grid gap-4">
          <NatalieHeroCard
            title={d.morningGreeting.headline || t("dashboardDesign.heroTitle")}
            recommendation={d.heroBriefing.recommendation}
            ctaLabel={d.heroBriefing.ctaLabel}
            onCta={d.handleHeroCta}
          />

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {d.snapshotMetrics.slice(0, 4).map((metric) => (
              <DashboardKpiCard key={metric.id} label={metric.label} value={metric.value} />
            ))}
          </section>

          <QuickActions title={t("dashboardDesign.quickActions")} items={quickActions} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TodayTimeline
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

            <WaitingForYouCard
              title={t("dashboardDesign.waitingForYou")}
              value={`${d.alerts.length}`}
              subtitle={t("dashboardDesign.waitingForYouSubtitle")}
              actionLabel={t("dashboardDesign.openQueue")}
              onAction={() => d.router.push("/dashboard/document-reviews")}
            />
          </div>

          <ActivityFeed
            title={t("dashboardDesign.activityFeed")}
            emptyText={t("dashboardDesign.emptyActivity")}
            items={d.activityTimeline.map((item) => ({
              id: item.id,
              text: item.text,
              occurredAt: item.occurredAt ?? new Date().toISOString(),
            }))}
          />
        </div>
      </AppShell>
    </div>
  );
}
