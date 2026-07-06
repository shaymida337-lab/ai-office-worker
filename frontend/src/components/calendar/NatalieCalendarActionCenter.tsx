"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarX2,
  CheckCircle2,
  Clock3,
  Sparkles,
} from "lucide-react";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";
import {
  findSchedulingConflicts,
  formatAppointmentTime,
  getAppointmentDayKey,
  toDateInputValue,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import type { BriefingPendingDecision } from "@/lib/scheduling/briefing";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

export type CalendarActionItem = {
  id: string;
  kind: "approval" | "conflict" | "reminder" | "cancelled" | "suggestion";
  title: string;
  subtitle?: string;
  actionLabel: string;
  onAction: () => void;
};

type NatalieCalendarActionCenterProps = {
  appointments: TimelineAppointment[];
  pendingDecisions?: BriefingPendingDecision[];
  loading?: boolean;
  onSelectAppointment: (id: string) => void;
  onApproveAppointment?: (id: string) => void;
};

function buildActionItems(input: NatalieCalendarActionCenterProps): CalendarActionItem[] {
  const todayKey = toDateInputValue(new Date());
  const todayAppointments = input.appointments.filter(
    (appt) => getAppointmentDayKey(appt.startTime) === todayKey
  );

  const items: CalendarActionItem[] = [];

  for (const appt of todayAppointments.filter((a) => a.status === "pending")) {
    items.push({
      id: `approval-${appt.id}`,
      kind: "approval",
      title: `לאישור: ${appt.client.name}`,
      subtitle: formatAppointmentTime(appt.startTime),
      actionLabel: "אשר",
      onAction: () => (input.onApproveAppointment ? input.onApproveAppointment(appt.id) : input.onSelectAppointment(appt.id)),
    });
  }

  for (const decision of input.pendingDecisions ?? []) {
    items.push({
      id: `decision-${decision.id}`,
      kind: "approval",
      title: decision.title,
      subtitle: decision.typeLabel,
      actionLabel: "פתח",
      onAction: () => {
        if (typeof window !== "undefined") {
          window.location.href = decision.href;
        }
      },
    });
  }

  for (const conflict of findSchedulingConflicts(input.appointments, todayKey)) {
    items.push({
      id: `conflict-${conflict.a}-${conflict.b}`,
      kind: "conflict",
      title: `התנגשות: ${conflict.clientA} ו-${conflict.clientB}`,
      subtitle: "שתי פגישות חופפות היום",
      actionLabel: "פתרון",
      onAction: () => openNatalieAssistant("עזרי לי לפתור התנגשות ביומן היום"),
    });
  }

  const now = Date.now();
  for (const appt of todayAppointments
    .filter((a) => a.status !== "cancelled" && new Date(a.startTime).getTime() >= now)
    .slice(0, 3)) {
    items.push({
      id: `reminder-${appt.id}`,
      kind: "reminder",
      title: `בקרוב: ${appt.client.name}`,
      subtitle: `${formatAppointmentTime(appt.startTime)} · ${appt.service?.name ?? "פגישה"}`,
      actionLabel: "פרטים",
      onAction: () => input.onSelectAppointment(appt.id),
    });
  }

  for (const appt of todayAppointments.filter((a) => a.status === "cancelled").slice(0, 2)) {
    items.push({
      id: `cancelled-${appt.id}`,
      kind: "cancelled",
      title: `בוטלה: ${appt.client.name}`,
      subtitle: formatAppointmentTime(appt.startTime),
      actionLabel: "קבע מחדש",
      onAction: () => openNatalieAssistant(`עזרי לי לקבוע מחדש פגישה עם ${appt.client.name}`),
    });
  }

  if (items.length === 0) {
    items.push({
      id: "suggestion-schedule",
      kind: "suggestion",
      title: "היום נראה שקט",
      subtitle: "זה זמן מצוין לתאם פגישות חדשות",
      actionLabel: "קבע פגישה",
      onAction: () => openNatalieAssistant("עזרי לי לקבוע פגישה חדשה"),
    });
  } else if (todayAppointments.filter((a) => a.status === "pending").length === 0) {
    items.push({
      id: "suggestion-slot",
      kind: "suggestion",
      title: "חפשי לי חלון פנוי",
      subtitle: "נטלי יכולה למצוא זמן פנוי ביומן",
      actionLabel: "מצא זמן",
      onAction: () => openNatalieAssistant("מצאי לי חלון פנוי ביומן השבוע"),
    });
  }

  return items.slice(0, 8);
}

function iconForKind(kind: CalendarActionItem["kind"]) {
  switch (kind) {
    case "approval":
      return CheckCircle2;
    case "conflict":
      return AlertTriangle;
    case "reminder":
      return Bell;
    case "cancelled":
      return CalendarX2;
    default:
      return Sparkles;
  }
}

function toneForKind(kind: CalendarActionItem["kind"]) {
  switch (kind) {
    case "approval":
      return { bg: "#FFFBEB", border: "#FDE68A", icon: "#D97706" };
    case "conflict":
      return { bg: "#FEF2F2", border: "#FECACA", icon: "#DC2626" };
    case "reminder":
      return { bg: "#EFF6FF", border: "#BFDBFE", icon: "#2563EB" };
    case "cancelled":
      return { bg: "#F8FAFC", border: "#E2E8F0", icon: "#64748B" };
    default:
      return { bg: "#F5F3FF", border: "#DDD6FE", icon: "#7C3AED" };
  }
}

export function NatalieCalendarActionCenter(props: NatalieCalendarActionCenterProps) {
  const items = useMemo(() => buildActionItems(props), [props]);

  return (
    <aside
      className={`${radius.card} ${shadow.soft} sticky top-24 border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      data-testid="natalie-calendar-action-center"
      aria-label="מרכז פעולות נטלי"
    >
      <div className="border-b border-[#E5E7EB] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-[#1D4ED8]" />
          <h2 className={typography.cardTitle} style={{ color: colors.textPrimary }}>
            מרכז פעולות
          </h2>
        </div>
        <p className="mt-1 text-sm font-semibold text-[#6B7280]">מה כדאי לעשות עכשיו</p>
      </div>

      <div className="space-y-2 p-3 sm:p-4">
        {props.loading ? (
          <>
            <div className="dashboard-shimmer h-20 rounded-xl" style={{ backgroundColor: colors.bgSoft }} />
            <div className="dashboard-shimmer h-20 rounded-xl" style={{ backgroundColor: colors.bgSoft }} />
          </>
        ) : (
          items.map((item) => {
            const Icon = iconForKind(item.kind);
            const tone = toneForKind(item.kind);
            return (
              <div
                key={item.id}
                className="rounded-xl border p-3"
                style={{ backgroundColor: tone.bg, borderColor: tone.border }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: colors.surface, color: tone.icon }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 text-right">
                    <div className="text-sm font-black text-[#111827]">{item.title}</div>
                    {item.subtitle && (
                      <div className="mt-0.5 text-xs font-semibold text-[#6B7280]">{item.subtitle}</div>
                    )}
                    <button
                      type="button"
                      className="mt-2 inline-flex min-h-9 items-center justify-center rounded-lg bg-white px-3 text-xs font-black text-[#111827] shadow-sm transition hover:bg-[#F8FAFC]"
                      onClick={item.onAction}
                    >
                      {item.actionLabel}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
