"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Edit3, Mail, MessageCircle, Navigation, Phone, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { SlidePanel, StatusBadge } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
import { apiFetch } from "@/lib/api";
import { buildWazeUrl } from "@/lib/contactActions";
import { resolveAppointmentDrawerContactActions } from "@/lib/calendar/appointmentDrawerContacts";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import { calendarUi } from "./calendarUi";

/**
 * חלון פרטי תור לתורים מהיומן הקיים (לא-מנוע): נפתח בלחיצה על כרטיס בתצוגת
 * השבוע. תורי מנוע ממשיכים להיפתח ב-CalendarEventDrawer הקיים — אין כפילות.
 */
export type AppointmentDetailsData = {
  id: string;
  clientId: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  notes?: string | null;
  client: {
    id: string;
    name: string;
    whatsappNumber?: string | null;
    phone?: string | null;
    email?: string | null;
    emailIsPlaceholder?: boolean | null;
    address?: string | null;
  };
  service?: { name: string } | null;
  employee?: { name: string } | null;
};

const NOT_PROVIDED = "לא הוזן";

function actionClass(enabled: boolean) {
  return enabled
    ? `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] px-3 text-sm font-black ${natalie.title} transition hover:bg-[var(--natalie-surface-elevated,#F8FAFF)]`
    : `inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] px-3 text-sm font-black ${natalie.subtitle} opacity-60`;
}

type FetchedContact = {
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  address: string | null;
};

export function AppointmentDetailsDrawer({
  appointment,
  statusLabel,
  statusTone,
  onClose,
  onEdit,
  refreshKey = 0,
}: {
  appointment: AppointmentDetailsData | null;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
  onClose: () => void;
  onEdit: () => void;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const orgTimezone = useOrganizationTimezone();
  const [fetchedContact, setFetchedContact] = useState<FetchedContact | null>(null);

  const provisionalClientId = appointment?.clientId?.trim() || appointment?.client?.id?.trim() || "";
  useEffect(() => {
    setFetchedContact(null);
    if (!provisionalClientId) return;
    let active = true;
    apiFetch<{
      client?: {
        phone?: string | null;
        whatsappNumber?: string | null;
        email?: string | null;
        emailIsPlaceholder?: boolean;
        address?: string | null;
      };
    }>(`/api/clients/${provisionalClientId}`)
      .then((result) => {
        if (!active) return;
        setFetchedContact({
          phone: result.client?.phone?.trim() || null,
          whatsappNumber: result.client?.whatsappNumber?.trim() || null,
          email: result.client?.emailIsPlaceholder ? null : result.client?.email?.trim() || null,
          address: result.client?.address?.trim() || null,
        });
      })
      .catch(() => {
        if (active) setFetchedContact(null);
      });
    return () => {
      active = false;
    };
  }, [provisionalClientId, refreshKey]);

  if (!appointment) return null;

  const rawName = appointment.client?.name?.trim() ?? "";
  const clientName = rawName.length >= 2 ? rawName : t("calendar.unidentifiedClient");

  const start = new Date(appointment.startTime);
  const end = new Date(start.getTime() + appointment.durationMinutes * 60_000);
  const dateLabel = start.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: orgTimezone,
  });
  const timeRange = `${start.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: orgTimezone })}–${end.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: orgTimezone })}`;

  const actions = resolveAppointmentDrawerContactActions({
    clientId: appointment.clientId,
    client: appointment.client,
    fetched: fetchedContact,
  });
  const { phoneDisplay, whatsappDisplay, emailDisplay, telHref, waHref, mailHref, openClientPath } = actions;
  const address = fetchedContact?.address ?? appointment.client?.address?.trim() ?? null;
  const wazeHref = buildWazeUrl(address);

  function goBackToCalendar() {
    onClose();
    router.push("/dashboard/calendar");
  }

  const rows: Array<{ label: string; value: string; ltr?: boolean }> = [
    { label: "תאריך", value: dateLabel },
    { label: "שעה", value: `${timeRange} · ${appointment.durationMinutes} ${t("calendar.minutesShort")}`, ltr: true },
    { label: t("calendar.serviceLabel"), value: appointment.service?.name || t("calendar.noService") },
    { label: "עובד", value: appointment.employee?.name || "בעל העסק" },
    { label: "טלפון", value: phoneDisplay || NOT_PROVIDED, ltr: Boolean(phoneDisplay) },
    { label: t("calendar.whatsapp"), value: whatsappDisplay || NOT_PROVIDED, ltr: Boolean(whatsappDisplay) },
    { label: t("calendar.email"), value: emailDisplay || NOT_PROVIDED, ltr: Boolean(emailDisplay) },
    { label: "כתובת", value: address || NOT_PROVIDED },
  ];

  return (
    <SlidePanel open title={clientName} subtitle={`${dateLabel} · ${timeRange}`} onClose={onClose}>
      <div className="relative z-10 grid gap-4" data-testid="appointment-details-drawer">
        <button
          type="button"
          className={`relative z-10 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent-primary bg-white px-3 text-sm font-black text-accent-primary transition hover:bg-[var(--natalie-surface-elevated,#F8FAFF)]`}
          onClick={goBackToCalendar}
          data-testid="back-to-calendar"
        >
          <ArrowRight className="h-4 w-4" aria-hidden />
          חזרה ליומן
        </button>

        <div className="flex items-center gap-2">
          <StatusBadge tone={statusTone(appointment.status)}>{statusLabel(appointment.status)}</StatusBadge>
        </div>

        <section className={calendarUi.drawerSection}>
          <dl className="grid gap-2 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className={`shrink-0 font-semibold ${natalie.subtitle}`}>{row.label}</dt>
                <dd
                  className={`min-w-0 truncate font-black ${natalie.title}`}
                  dir={row.ltr ? "ltr" : undefined}
                  title={row.value}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {appointment.notes ? (
          <section className={calendarUi.drawerSection}>
            <h3 className={`mb-1 text-sm font-black ${natalie.title}`}>{t("calendar.notes")}</h3>
            <p className={`whitespace-pre-wrap text-sm font-semibold ${natalie.subtitle}`}>{appointment.notes}</p>
          </section>
        ) : null}

        <section className={calendarUi.drawerSection}>
          <h3 className={`mb-2 text-sm font-black ${natalie.title}`}>{t("calendar.quickActions")}</h3>
          <div className="relative z-10 grid grid-cols-2 gap-2">
            {telHref ? (
              <a href={telHref} className={actionClass(true)} data-testid="appt-action-call">
                <Phone className="h-4 w-4" />
                {t("calendar.call")}
              </a>
            ) : (
              <button type="button" disabled aria-disabled="true" className={actionClass(false)} data-testid="appt-action-call">
                <Phone className="h-4 w-4" />
                {t("calendar.call")}
              </button>
            )}
            {waHref ? (
              <a href={waHref} target="_blank" rel="noreferrer" className={actionClass(true)} data-testid="appt-action-whatsapp">
                <MessageCircle className="h-4 w-4" />
                {t("calendar.whatsapp")}
              </a>
            ) : (
              <button type="button" disabled aria-disabled="true" className={actionClass(false)} data-testid="appt-action-whatsapp">
                <MessageCircle className="h-4 w-4" />
                {t("calendar.whatsapp")}
              </button>
            )}
            {mailHref ? (
              <a href={mailHref} className={actionClass(true)} data-testid="appt-action-email">
                <Mail className="h-4 w-4" />
                שלח מייל
              </a>
            ) : (
              <button type="button" disabled aria-disabled="true" className={actionClass(false)} data-testid="appt-action-email">
                <Mail className="h-4 w-4" />
                שלח מייל
              </button>
            )}
            {wazeHref ? (
              <a href={wazeHref} target="_blank" rel="noreferrer" className={actionClass(true)} data-testid="appt-action-waze">
                <Navigation className="h-4 w-4" />
                Waze
              </a>
            ) : null}
            {openClientPath ? (
              <button
                type="button"
                className={actionClass(true)}
                data-testid="appt-action-open-client"
                onClick={() => router.push(openClientPath)}
              >
                <UserRound className="h-4 w-4" />
                פתח כרטיס לקוח
              </button>
            ) : (
              <button type="button" disabled aria-disabled="true" className={actionClass(false)} data-testid="appt-action-open-client">
                <UserRound className="h-4 w-4" />
                פתח כרטיס לקוח
              </button>
            )}
            <button type="button" className={`${actionClass(true)} col-span-2`} onClick={onEdit} data-testid="appt-action-edit">
              <Edit3 className="h-4 w-4" />
              {t("calendar.edit")}
            </button>
          </div>
        </section>
      </div>
    </SlidePanel>
  );
}
