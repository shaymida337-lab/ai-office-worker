export type YourDayItem = {
  id: string;
  text: string;
  priority: number;
  urgency: "urgent" | "warn" | "calm";
  onAction?: () => void;
};

type AppointmentInput = {
  id: string;
  startTime: string;
  clientName: string;
};

type BuildYourDayInput = {
  now?: Date;
  upcomingAppointments?: AppointmentInput[];
  pendingDocuments?: number;
  pendingPayments?: number;
  overduePayments?: number;
  openTasks?: number;
};

function minutesUntil(startTime: string, now: Date) {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return null;
  return Math.round((start.getTime() - now.getTime()) / 60_000);
}

function formatAppointmentWait(minutes: number) {
  if (minutes <= 0) return "יש פגישה עכשיו";
  if (minutes < 60) return `יש פגישה בעוד ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "יש פגישה בעוד שעה";
  if (hours < 24) return `יש פגישה בעוד ${hours} שעות`;
  return "יש פגישה בקרוב";
}

export function buildYourDayItems(input: BuildYourDayInput): YourDayItem[] {
  const now = input.now ?? new Date();
  const items: YourDayItem[] = [];

  const nextAppointment = [...(input.upcomingAppointments ?? [])]
    .filter((appt) => {
      const minutes = minutesUntil(appt.startTime, now);
      return minutes !== null && minutes >= 0 && minutes <= 24 * 60;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

  if (nextAppointment) {
    const minutes = minutesUntil(nextAppointment.startTime, now) ?? 0;
    items.push({
      id: `appt-${nextAppointment.id}`,
      text: formatAppointmentWait(minutes),
      priority: minutes <= 60 ? 1 : 2,
      urgency: minutes <= 60 ? "urgent" : "warn",
    });
  }

  const overdue = input.overduePayments ?? 0;
  const pendingPayments = input.pendingPayments ?? 0;
  if (overdue > 0) {
    items.push({
      id: "payments-overdue",
      text: overdue === 1 ? "תשלום אחד באיחור" : `${overdue} תשלומים באיחור`,
      priority: 1,
      urgency: "urgent",
    });
  } else if (pendingPayments > 0) {
    items.push({
      id: "payments-pending",
      text: pendingPayments === 1 ? "תשלום אחד ממתין" : `${pendingPayments} תשלומים ממתינים`,
      priority: 2,
      urgency: "warn",
    });
  }

  const documents = input.pendingDocuments ?? 0;
  if (documents > 0) {
    items.push({
      id: "documents",
      text: documents === 1 ? "מסמך אחד מחכה לאישור" : `${documents} מסמכים לאישור`,
      priority: 2,
      urgency: documents > 2 ? "urgent" : "warn",
    });
  }

  const tasks = input.openTasks ?? 0;
  if (tasks > 0) {
    items.push({
      id: "tasks",
      text: tasks === 1 ? "משימה אחת פתוחה" : `${tasks} משימות פתוחות`,
      priority: 3,
      urgency: tasks > 5 ? "urgent" : "warn",
    });
  }

  if (items.length === 0) {
    return [
      {
        id: "all-clear",
        text: nextAppointment ? "אין משימות דחופות מעבר לפגישה" : "אין משימות דחופות — היום פנוי כרגע",
        priority: 9,
        urgency: "calm",
      },
    ];
  }

  return items.sort((a, b) => a.priority - b.priority);
}
