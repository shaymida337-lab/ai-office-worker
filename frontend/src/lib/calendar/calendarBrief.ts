import { greetingForHour } from "@/lib/natalie/copy";
import {
  computeFreeMinutesToday,
  formatAppointmentTime,
  getAppointmentDayKey,
  toDateInputValue,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import type { BriefingPendingDecision, BriefingSchedulingSnapshot } from "@/lib/scheduling/briefing";

export type CalendarDailyBrief = {
  greeting: string;
  dateLabel: string;
  meetingCount: number;
  freeTimeLabel: string;
  pendingApprovalCount: number;
  openTaskCount: number;
  summaryLines: string[];
  recommendation: string;
  stats: Array<{ id: string; label: string; value: string }>;
};

type BuildCalendarDailyBriefInput = {
  now?: Date;
  ownerFirstName?: string | null;
  timeZone?: string;
  todayAppointments: TimelineAppointment[];
  briefing?: BriefingSchedulingSnapshot | null;
  openTaskCount?: number;
};

function formatFreeTimeLabel(minutes: number): string {
  if (minutes <= 0) return "אין זמן פנוי";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} דק׳ פנויות`;
  if (rest === 0) return hours === 1 ? "שעה פנויה" : `${hours} שעות פנויות`;
  return `${hours}:${String(rest).padStart(2, "0")} שעות פנויות`;
}

function countPendingApprovals(
  todayAppointments: TimelineAppointment[],
  briefing?: BriefingSchedulingSnapshot | null
): number {
  const legacyPending = todayAppointments.filter((appt) => appt.status === "pending").length;
  const briefingPending = briefing?.todaySummary.pendingDecisionCount ?? 0;
  const upcomingPending = (briefing?.upcoming ?? []).filter((item) => item.pendingOwnerApproval).length;
  return Math.max(legacyPending, briefingPending, upcomingPending);
}

function findUrgentPendingAppointment(
  todayAppointments: TimelineAppointment[],
  pendingDecisions: BriefingPendingDecision[],
  now: Date,
  timeZone?: string
): { clientName: string; timeLabel: string } | null {
  const pendingToday = todayAppointments
    .filter((appt) => appt.status === "pending")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const next = pendingToday.find((appt) => new Date(appt.startTime).getTime() >= now.getTime()) ?? pendingToday[0];
  if (next) {
    return {
      clientName: next.client.name,
      timeLabel: formatAppointmentTime(next.startTime, timeZone),
    };
  }

  const decision = pendingDecisions[0];
  if (decision?.title) {
    const match = decision.title.match(/(.+?)(?:\s*[-–—]\s*|$)/);
    return {
      clientName: match?.[1]?.trim() || decision.title,
      timeLabel: "",
    };
  }

  return null;
}

function buildRecommendation(input: {
  pendingApprovalCount: number;
  meetingCount: number;
  openTaskCount: number;
  todayAppointments: TimelineAppointment[];
  pendingDecisions: BriefingPendingDecision[];
  now: Date;
  timeZone?: string;
}): string {
  const urgent = findUrgentPendingAppointment(
    input.todayAppointments,
    input.pendingDecisions,
    input.now,
    input.timeZone
  );

  if (input.pendingApprovalCount > 0 && urgent) {
    const timePart = urgent.timeLabel ? ` לפני השעה ${urgent.timeLabel}` : "";
    return `אני ממליצה לאשר את הפגישה של ${urgent.clientName}${timePart}.`;
  }

  if (input.meetingCount === 0) {
    return "היום שלך פנוי 😊 רוצה שאעזור לך לקבוע פגישה?";
  }

  if (input.openTaskCount > 0 && input.meetingCount >= 3) {
    return "יש לך יום עמוס. כדאי לסגור משימה אחת בין הפגישות.";
  }

  if (input.meetingCount > 0) {
    const next = [...input.todayAppointments]
      .filter((appt) => appt.status !== "cancelled")
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .find((appt) => new Date(appt.startTime).getTime() >= input.now.getTime());

    if (next) {
      return `הפגישה הבאה שלך עם ${next.client.name} בשעה ${formatAppointmentTime(next.startTime, input.timeZone)}.`;
    }
  }

  return "הכל מסודר להיום. אני כאן אם תרצה לשנות משהו ביומן.";
}

export function buildCalendarDailyBrief(input: BuildCalendarDailyBriefInput): CalendarDailyBrief {
  const now = input.now ?? new Date();
  const dayKey = toDateInputValue(now);
  const todayAppointments = input.todayAppointments.filter(
    (appt) => getAppointmentDayKey(appt.startTime) === dayKey && appt.status !== "cancelled"
  );
  const meetingCount = todayAppointments.length;
  const freeMinutes = computeFreeMinutesToday(input.todayAppointments, dayKey);
  const pendingApprovalCount = countPendingApprovals(todayAppointments, input.briefing);
  const openTaskCount = input.openTaskCount ?? 0;
  const pendingDecisions = input.briefing?.pendingDecisions ?? [];

  const greetingBase = greetingForHour(now, input.ownerFirstName);
  const greeting = now.getHours() >= 5 && now.getHours() < 12 ? `${greetingBase} ☀️` : greetingBase;

  const dateLabel = now.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  });

  const summaryParts: string[] = [];
  if (meetingCount > 0) {
    summaryParts.push(meetingCount === 1 ? "פגישה אחת" : `${meetingCount} פגישות`);
  } else {
    summaryParts.push("אין פגישות היום");
  }
  if (openTaskCount > 0) {
    summaryParts.push(openTaskCount === 1 ? "משימה פתוחה אחת" : `${openTaskCount} משימות פתוחות`);
  }
  if (pendingApprovalCount > 0) {
    summaryParts.push(
      pendingApprovalCount === 1 ? "פגישה אחת שמחכה לאישור" : `${pendingApprovalCount} פגישות שמחכות לאישור`
    );
  }

  const summaryLine =
    summaryParts.length > 0
      ? `היום יש לך ${summaryParts.join(", ").replace(/, ([^,]*)$/, " ו$1")}.`
      : "היום נראה שקט ביומן.";

  return {
    greeting,
    dateLabel,
    meetingCount,
    freeTimeLabel: formatFreeTimeLabel(freeMinutes),
    pendingApprovalCount,
    openTaskCount,
    summaryLines: [summaryLine],
    recommendation: buildRecommendation({
      pendingApprovalCount,
      meetingCount,
      openTaskCount,
      todayAppointments: input.todayAppointments.filter((appt) => getAppointmentDayKey(appt.startTime) === dayKey),
      pendingDecisions,
      now,
      timeZone: input.timeZone,
    }),
    stats: [
      { id: "meetings", label: "פגישות היום", value: String(meetingCount) },
      { id: "free", label: "זמן פנוי", value: formatFreeTimeLabel(freeMinutes) },
      { id: "approvals", label: "ממתינות לאישור", value: String(pendingApprovalCount) },
      { id: "tasks", label: "משימות פתוחות", value: String(openTaskCount) },
    ],
  };
}
