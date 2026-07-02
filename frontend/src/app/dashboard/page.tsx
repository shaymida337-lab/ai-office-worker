"use client";

import { type ReactNode } from "react";
import { Nav } from "@/components/Nav";
import {
  NatalieMorningBrief,
  NatalieYourDay,
  BusinessSnapshot,
  DashboardActivityTimeline,
  DashboardQuickActions,
  quickActionIcons,
  NatalieTopBar,
} from "@/components/dashboard";
import { NatalieCommandBar } from "@/components/dashboard/NatalieCommandBar";
import { DashboardHomeStatus } from "@/components/dashboard/home/DashboardHomeStatus";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScanBanner } from "@/components/ui/ScanBanner";
import { StatusPill } from "@/components/ui/StatusPill";
import { IntegrationStatusCard } from "@/components/ui/IntegrationStatusCard";
import { labelFor } from "@/lib/labels";
import { colors, radius, shadow, spacing, button, type as typography } from "@/lib/design-tokens";
import { useDashboardHome } from "@/hooks/useDashboardHome";
import {
  alertTypeLabel,
  fallbackComponent,
  formatDate,
  formatDateTime,
  formatNumber,
  formatShekel,
  relativeTime,
  systemComponentLabel,
  systemReasonLabel,
  taskPriorityLabel,
} from "@/lib/dashboard/homePageHelpers";
import type {
  ScanToast,
  SystemComponentStatus,
  SystemHealth,
  WhatsAppAssistantStats,
  WhatsAppScanResult,
} from "@/lib/dashboard/homePageTypes";

export default function DashboardPage() {
  const d = useDashboardHome();

  return (
    <main
      className="dashboard-shell h-auto min-h-screen max-w-full overflow-x-clip px-3 pb-[calc(12rem+env(safe-area-inset-bottom,0px))] pt-[3.75rem] md:px-8 md:pt-[4.5rem] lg:mr-60 lg:overflow-x-clip lg:overflow-y-visible lg:pb-32 lg:pt-20"
      style={{
        background: colors.bg,
        color: colors.textPrimary,
        minHeight: "100vh",
        height: "auto",
      }}
    >
      <Nav />

      <div className="dashboard-home-stack mx-auto grid h-auto min-w-0 max-w-6xl gap-4 overflow-x-clip md:gap-5 lg:gap-6">
        {(d.pageError || d.displayActionMessage || d.displayToast) && (
          <MessageStack error={d.pageError} actionMessage={d.displayActionMessage} toast={d.displayToast} />
        )}

        <NatalieTopBar
          businessName={d.businessName}
          unreadCount={d.stats?.unreadAlerts ?? 0}
          onNotifications={() => d.router.push("/message-scans")}
        />

        <NatalieMorningBrief
          greeting={d.morningGreeting.headline}
          recommendation={d.heroBriefing.recommendation}
          ctaLabel={d.heroBriefing.ctaLabel}
          loading={d.pageLoading}
          onCta={d.handleHeroCta}
        />

        <DashboardHomeStatus
          state={d.dashboardSyncState}
          loading={d.pageLoading}
          onConnectGmail={() => void d.connectGmail()}
          onRetrySync={() => void d.runSync()}
          onOpenSettings={() => d.router.push("/dashboard/settings")}
        />

        {d.dashboardSyncState.showScanBanner && d.dashboardSyncState.scanBanner ? (
          <div id="gmail-scan-progress" className="dashboard-fade-in">
            <ScanBanner
              status={d.dashboardSyncState.scanBanner.status}
              found={d.dashboardSyncState.scanBanner.found}
              scanned={d.dashboardSyncState.scanBanner.scanned}
              totalMatched={d.dashboardSyncState.scanBanner.totalMatched}
              errors={d.dashboardSyncState.scanBanner.errors}
            />
          </div>
        ) : (
          <div id="gmail-scan-progress" className="dashboard-home-section" />
        )}

        <BusinessSnapshot metrics={d.snapshotMetrics} loading={d.pageLoading} />

        <NatalieYourDay items={d.yourDayItems} loading={d.pageLoading} />

        <div id="natalie-command" className="dashboard-home-section space-y-4">
          <DashboardQuickActions
            actions={[
              {
                id: "ask-natalie",
                label: "שאל את נטלי",
                icon: quickActionIcons.ask,
                onClick: () => {
                  document.getElementById("natalie-command")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  window.setTimeout(() => document.getElementById("natalie-command-input")?.focus(), 280);
                },
              },
              {
                id: "scan-email",
                label: "סרוק מיילים",
                icon: quickActionIcons.scan,
                onClick: () => void d.runSync(),
                disabled: d.syncing,
              },
              {
                id: "upload-document",
                label: "העלה מסמך",
                icon: quickActionIcons.upload,
                onClick: () => d.router.push("/camera"),
              },
            ]}
          />
          <NatalieCommandBar
            onSubmit={d.handleNatalieConversation}
            onScan={d.runSync}
            suggestions={[]}
          />
        </div>

        <div className="dashboard-home-section hidden md:block" data-activity-mobile="hidden">
          <DashboardActivityTimeline items={d.activityTimeline} loading={d.pageLoading} />
        </div>

        <section className="dashboard-fade-in dashboard-home-section lg:max-w-2xl">
          <h2 className={`mb-2.5 ${typography.sectionTitle}`} style={{ color: colors.textPrimary }}>
            חיבורים
          </h2>
          <div
            className={`${radius.card} ${shadow.soft} border p-4 md:p-5`}
            style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
          >
            <IntegrationStatusCard
              icon="📬"
              title="Gmail"
              compact
              model={d.gmailIntegrationModel}
              actions={d.gmailCardActions}
              detailsTitle="פרטים נוספים"
            />
          </div>
        </section>

        <details className={`${radius.card} border`} style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}>
          <summary className="cursor-pointer list-none px-5 py-5 text-lg font-bold md:px-6" style={{ color: colors.textPrimary }}>
            כלים ואוטומציה
          </summary>
          <div className={`grid ${spacing.section} border-t p-5 md:p-6`} style={{ borderColor: colors.borderSubtle }}>
            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
              <ActivityCard title="תשלומי ספקים" empty="ברגע שיגיעו תשלומים חדשים אציג אותם כאן.">
                {d.payments.slice(0, 5).map((payment) => (
                  <DataRow
                    key={payment.id}
                    title={payment.supplier || "ספק לא ידוע"}
                    meta={`${formatDate(payment.date)} · ${formatShekel(payment.amount)}`}
                    pill={<StatusPill tone={payment.paid ? "success" : "warn"}>{labelFor("paymentStatus", payment.paid ? "paid" : "pending")}</StatusPill>}
                    action={!payment.paid ? <SecondaryButton onClick={() => d.markPaymentPaid(payment.id)}>סמן שולם</SecondaryButton> : null}
                  />
                ))}
              </ActivityCard>

              <ActivityCard title="חשבוניות חסרות" empty="אין חשבוניות חסרות">
                {d.missingInvoices.slice(0, 5).map((payment) => (
                  <DataRow
                    key={payment.id}
                    title={payment.supplier || "ספק לא ידוע"}
                    meta={`${payment.subject ?? "ללא נושא"} · ${formatDate(payment.date)}`}
                    pill={<StatusPill tone="warn">{labelFor("paymentStatus", "missing_invoice")}</StatusPill>}
                    action={<SecondaryButton onClick={() => d.attachInvoiceToPayment(payment.id)}>צרף קישור</SecondaryButton>}
                  />
                ))}
              </ActivityCard>
            </section>

            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
              <ActivityCard title="חשבוניות אחרונות" empty="ברגע שיגיעו מסמכים חדשים אציג אותם כאן.">
                {d.recentInvoices.slice(0, 5).map((invoice) => (
                  <DataRow
                    key={invoice.id}
                    title={invoice.client?.name ?? "לקוח לא ידוע"}
                    meta={`${formatDate(invoice.date)} · ${formatShekel(invoice.amount)}`}
                    pill={<StatusPill tone={invoice.status === "paid" ? "success" : "warn"}>{labelFor("paymentStatus", invoice.status)}</StatusPill>}
                    action={invoice.driveUrl ? <SecondaryLink href={invoice.driveUrl}>פתח בדרייב</SecondaryLink> : null}
                  />
                ))}
              </ActivityCard>

              <ActivityCard title="משימות אחרונות" empty="היום פנוי ממשימות פתוחות.">
                {d.recentTasks.slice(0, 5).map((task) => (
                  <DataRow
                    key={task.id}
                    title={task.title}
                    meta={`${task.supplier ?? "כללי"} · ${taskPriorityLabel(task.priority)}`}
                    pill={<StatusPill tone={task.status === "completed" || task.status === "done" ? "success" : "info"}>{labelFor("scanStatus", task.status)}</StatusPill>}
                  />
                ))}
              </ActivityCard>
            </section>

            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
              <ActivityCard title="כשלים ותור בדיקה" empty="אין כשלים פתוחים">
                {d.alerts.slice(0, 5).map((alert) => (
                  <DataRow
                    key={alert.id}
                    title={alert.title}
                    meta={alert.body ?? formatDateTime(alert.createdAt)}
                    pill={<StatusPill tone={alert.type === "error" ? "danger" : "warn"}>{alertTypeLabel(alert.type)}</StatusPill>}
                    action={<SecondaryButton onClick={d.runSync}>נסה שוב</SecondaryButton>}
                  />
                ))}
              </ActivityCard>

              <ActivityCard title="לקוחות אחרונים" empty="ברגע שיתווספו לקוחות חדשים אציג אותם כאן.">
                {(d.clients?.clients ?? []).slice(0, 5).map((client) => (
                  <DataRow
                    key={client.id}
                    title={client.name}
                    meta={`${formatShekel(client.stats?.toPay ?? 0)} לתשלום · ${client.stats?.invoices ?? 0} חשבוניות`}
                    pill={<StatusPill tone={client.stats?.missingInvoices ? "warn" : "success"}>{client.stats?.missingInvoices ? `${client.stats.missingInvoices} חסרות` : "תקין"}</StatusPill>}
                  />
                ))}
              </ActivityCard>
            </section>

            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
              <SystemCard
                gmailConnected={d.gmailConnection.phase === "connected" || d.gmailApiConnected}
                gmailConnectAllowed={d.gmailConnection.phase === "disconnected"}
                whatsAppConnected={d.whatsAppConnected}
                systemHealth={d.systemHealth}
                systemChecking={d.systemChecking}
                showSystemCheck={d.showSystemCheck}
                onConnectGmail={d.connectGmail}
                onConnectWhatsApp={() => d.router.push("/dashboard/whatsapp")}
                onRunSystemCheck={d.runSystemCheck}
              />

              <WhatsAppCard
                whatsAppConnected={d.whatsAppConnected}
                whatsAppScanning={d.whatsAppScanning}
                whatsAppScanRange={d.whatsAppScanRange}
                whatsAppScanResult={d.whatsAppScanResult}
                whatsAppStats={d.whatsAppStats}
                onRangeChange={d.setWhatsAppScanRange}
                onRun={d.runWhatsAppScan}
                onOpen={() => d.router.push("/dashboard/whatsapp")}
              />
            </section>

            <section className={`grid ${spacing.section} lg:grid-cols-2`}>
              <ActivityCard title="אוטומציה וסריקות" empty="אין נתוני סריקה עדיין">
                <DataRow title="עודכן לאחרונה" meta={d.clientMounted && d.lastUpdatedAt ? relativeTime(d.lastUpdatedAt) : "טוען"} pill={<StatusPill tone="info">פעיל</StatusPill>} />
                <DataRow title="סריקה הבאה" meta={d.clientMounted && d.scanStatus?.nextScheduledScanAt ? formatDateTime(d.scanStatus.nextScheduledScanAt) : "טוען"} />
                {d.scanStatus?.last && (
                  <DataRow
                    title="סריקה אחרונה"
                    meta={`מיילים ${formatNumber(d.scanStatus.last.found)} · נשמרו ${formatNumber(d.scanStatus.last.saved)}`}
                    pill={<StatusPill tone={d.scanStatus.last.status === "success" ? "success" : d.scanStatus.last.status === "partial" ? "warn" : "danger"}>{labelFor("scanStatus", d.scanStatus.last.status)}</StatusPill>}
                    action={<SecondaryButton onClick={() => d.router.push("/dashboard/scan-stats")}>סטטיסטיקות</SecondaryButton>}
                  />
                )}
              </ActivityCard>

              <ActivityCard title="סיכום יומי" empty="אין סיכום זמין">
                <p className={`${typography.body} whitespace-pre-wrap leading-7`} style={{ color: colors.textSecondary }}>{d.summary}</p>
                <div className="flex flex-wrap gap-3">
                  <SecondaryButton onClick={d.scanAllClients} disabled={d.syncing}>סרוק לקוחות</SecondaryButton>
                  <SecondaryButton onClick={() => d.router.push("/camera")}>צלם חשבונית</SecondaryButton>
                  <SecondaryButton onClick={() => d.router.push("/dashboard/settings")}>הגדרות</SecondaryButton>
                </div>
              </ActivityCard>
            </section>
          </div>
        </details>

        <div className="h-4 shrink-0 lg:hidden" aria-hidden />
      </div>

      {d.invoiceAttachPaymentId && (
        <div className={`fixed inset-0 z-[100] grid place-items-center ${spacing.page}`} style={{ backgroundColor: colors.bg }}>
          <form className={`${radius.card} ${shadow.raised} ${spacing.card} w-full max-w-lg`} style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }} onSubmit={d.submitInvoiceAttachment}>
            <h2 className={typography.sectionTitle}>צירוף חשבונית לתשלום</h2>
            <p className={`${typography.body} mt-2`} style={{ color: colors.textSecondary }}>הדבק קישור לחשבונית בדרייב כדי לסגור את החוסר בתשלום הספק.</p>
            <label className="mt-4">
              קישור לחשבונית
              <input dir="ltr" value={d.invoiceAttachLink} onChange={(event) => d.setInvoiceAttachLink(event.target.value)} placeholder="https://drive.google.com/..." autoFocus />
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className={`${radius.control} ${button.primary}`} style={{ backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }} type="submit" disabled={!d.invoiceAttachLink.trim()}>צרף חשבונית</button>
              <SecondaryButton type="button" onClick={() => d.setInvoiceAttachPaymentId(null)}>ביטול</SecondaryButton>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function ActivityCard({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Boolean(children) && (!Array.isArray(children) || children.length > 0);
  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card}`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
    >
      {title ? <h2 className={typography.cardTitle} style={{ color: colors.textPrimary }}>{title}</h2> : null}
      <div className={`${title ? "mt-5" : ""} grid ${spacing.inline}`}>
        {hasChildren ? children : <EmptyState title={empty} compact />}
      </div>
    </section>
  );
}

function DataRow({ title, meta, pill, action }: { title: ReactNode; meta: ReactNode; pill?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className={`${radius.control} flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5`}
      style={{ backgroundColor: colors.bgSoft, border: `1px solid ${colors.borderSubtle}` }}
    >
      <div className="min-w-0 flex-1">
        <div className={`${typography.cardTitle} truncate`} style={{ color: colors.textPrimary }}>{title}</div>
        <div className={`${typography.caption} mt-1.5 break-words min-w-0`} style={{ color: colors.textSecondary }}>{meta}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pill}
        {action}
      </div>
    </div>
  );
}

function MessageStack({ error, actionMessage, toast }: { error: string; actionMessage: string; toast: ScanToast | null }) {
  return (
    <div className="grid gap-3">
      {error && <InlineMessage tone="danger">{error}</InlineMessage>}
      {actionMessage && <InlineMessage tone="success">{actionMessage}</InlineMessage>}
      {toast && <InlineMessage tone={toast.type === "warning" ? "warn" : toast.type === "error" ? "danger" : toast.type}>{toast.text}</InlineMessage>}
    </div>
  );
}

function InlineMessage({ tone, children }: { tone: "info" | "success" | "warn" | "danger"; children: ReactNode }) {
  const style = tone === "success"
    ? { color: colors.successText, backgroundColor: colors.successBg, borderColor: colors.successBorder }
    : tone === "warn"
      ? { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder }
      : tone === "danger"
        ? { color: colors.dangerText, backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }
        : { color: colors.infoText, backgroundColor: colors.infoBg, borderColor: colors.infoBorder };
  return <div className={`${radius.card} ${spacing.card} border ${typography.body} font-bold leading-7`} style={style}>{children}</div>;
}

function SecondaryButton({ children, onClick, disabled, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${radius.control} ${button.secondary} disabled:opacity-60`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}
    >
      {children}
    </button>
  );
}

function SecondaryLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      href={href}
      className={`${radius.control} inline-flex ${button.secondary} items-center justify-center`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

function SystemCard({
  gmailConnected,
  gmailConnectAllowed = true,
  whatsAppConnected,
  systemHealth,
  systemChecking,
  showSystemCheck,
  onConnectGmail,
  onConnectWhatsApp,
  onRunSystemCheck,
}: {
  gmailConnected: boolean;
  gmailConnectAllowed?: boolean;
  whatsAppConnected: boolean;
  systemHealth: SystemHealth | null;
  systemChecking: boolean;
  showSystemCheck: boolean;
  onConnectGmail: () => void;
  onConnectWhatsApp: () => void;
  onRunSystemCheck: () => void;
}) {
  const components: SystemComponentStatus[] = [
    systemHealth?.components.gmail ?? fallbackComponent("gmail", "ג׳ימייל", gmailConnected),
    systemHealth?.components.drive ?? fallbackComponent("drive", "גוגל דרייב", false),
    systemHealth?.components.sheets ?? fallbackComponent("sheets", "גוגל שיטס", false),
    systemHealth?.components.whatsapp ?? fallbackComponent("whatsapp", "וואטסאפ", whatsAppConnected),
    systemHealth?.components.database ?? fallbackComponent("database", "מסד נתונים", false),
  ];
  return (
    <ActivityCard title="חיבורי מערכת" empty="אין נתוני מערכת">
      {components.map((component) => (
        <DataRow
          key={component.name}
          title={systemComponentLabel(component.label)}
          meta={systemReasonLabel(component.reason) ?? "הבדיקה החיה עברה בהצלחה"}
          pill={<StatusPill tone={component.connected ? "success" : "danger"}>{component.connected ? "מחובר" : "לא מחובר"}</StatusPill>}
          action={!component.connected && component.name === "gmail" && gmailConnectAllowed ? <SecondaryButton onClick={onConnectGmail}>חבר</SecondaryButton> : !component.connected && component.name === "whatsapp" ? <SecondaryButton onClick={onConnectWhatsApp}>חבר</SecondaryButton> : null}
        />
      ))}
      <div className="flex flex-wrap gap-3">
        <SecondaryButton onClick={onRunSystemCheck} disabled={systemChecking}>{systemChecking ? "בודק..." : "בדיקת מערכת"}</SecondaryButton>
        {showSystemCheck && <StatusPill tone={systemHealth?.allPassed ? "success" : "warn"}>{systemHealth?.allPassed ? "הכל תקין" : "יש נושאים לבדיקה"}</StatusPill>}
      </div>
    </ActivityCard>
  );
}

function WhatsAppCard({
  whatsAppConnected,
  whatsAppScanning,
  whatsAppScanRange,
  whatsAppScanResult,
  whatsAppStats,
  onRangeChange,
  onRun,
  onOpen,
}: {
  whatsAppConnected: boolean;
  whatsAppScanning: boolean;
  whatsAppScanRange: string;
  whatsAppScanResult: WhatsAppScanResult | null;
  whatsAppStats: WhatsAppAssistantStats | null;
  onRangeChange: (value: string) => void;
  onRun: () => void;
  onOpen: () => void;
}) {
  return (
    <ActivityCard title="וואטסאפ" empty="וואטסאפ לא מחובר">
      <DataRow title="הודעות היום" meta={`${formatNumber(whatsAppStats?.sentToday ?? 0)} נשלחו · ${formatNumber(whatsAppStats?.activeChats ?? 0)} שיחות פעילות`} pill={<StatusPill tone={whatsAppConnected ? "success" : "danger"}>{whatsAppConnected ? "מחובר" : "לא מחובר"}</StatusPill>} />
      <div className="grid gap-3 sm:grid-cols-2">
        <select value={whatsAppScanRange} onChange={(event) => onRangeChange(event.target.value)} disabled={whatsAppScanning || !whatsAppConnected}>
          <option value="7">7 ימים</option>
          <option value="30">30 ימים</option>
          <option value="90">90 ימים</option>
          <option value="full">סריקה מלאה</option>
        </select>
        <SecondaryButton onClick={onRun} disabled={whatsAppScanning || !whatsAppConnected}>{whatsAppScanning ? "סורק..." : "סריקת וואטסאפ"}</SecondaryButton>
      </div>
      {whatsAppScanResult && <p className={typography.body} style={{ color: colors.textSecondary }}>נסרקו {formatNumber(whatsAppScanResult.messagesScanned)} הודעות · נמצאו {formatNumber(whatsAppScanResult.supplierPaymentsFound)} תשלומי ספקים · {formatNumber(whatsAppScanResult.errorsCount)} שגיאות</p>}
      <SecondaryButton onClick={onOpen}>פתח מרכז וואטסאפ</SecondaryButton>
    </ActivityCard>
  );
}

