export type AlreadyWorkedItem = {
  id: string;
  text: string;
};

export type AlreadyWorkedSummary = {
  items: AlreadyWorkedItem[];
  emptyMessage: string;
};

type BuildAlreadyWorkedInput = {
  gmailConnected?: boolean;
  scanRunning?: boolean;
  emailsScanned?: number;
  invoicesFound?: number;
  paymentsUpdated?: number;
  appointmentsSet?: number;
  tasksCreated?: number;
  newDocuments?: number;
};

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

export function buildAlreadyWorkedSummary(input: BuildAlreadyWorkedInput): AlreadyWorkedSummary {
  const emptyMessage = input.gmailConnected
    ? "עדיין לא הספקתי הרבה היום — ברגע שיגיעו מסמכים חדשים אעדכן אותך כאן."
    : "אני מוכנה להתחיל לעבוד ברגע שתחבר את Gmail.";

  if (input.scanRunning) {
    return {
      items: [{ id: "scanning", text: "סורקת עבורך מסמכים מהמייל..." }],
      emptyMessage,
    };
  }

  const items: AlreadyWorkedItem[] = [];

  const emails = input.emailsScanned ?? 0;
  if (emails > 0) {
    items.push({
      id: "emails",
      text: `סרקתי ${emails} ${pluralize(emails, "מייל", "מיילים")}`,
    });
  }

  const invoices = input.invoicesFound ?? 0;
  if (invoices > 0) {
    items.push({
      id: "invoices",
      text: `מצאתי ${invoices} ${pluralize(invoices, "חשבונית", "חשבוניות")}`,
    });
  }

  const payments = input.paymentsUpdated ?? 0;
  if (payments > 0) {
    items.push({
      id: "payments",
      text: `עדכנתי ${payments} ${pluralize(payments, "תשלום", "תשלומים")}`,
    });
  }

  const appointments = input.appointmentsSet ?? 0;
  if (appointments > 0) {
    items.push({
      id: "appointments",
      text: pluralize(appointments, "קבעתי פגישה אחת", `קבעתי ${appointments} פגישות`),
    });
  }

  const tasks = input.tasksCreated ?? 0;
  if (tasks > 0) {
    items.push({
      id: "tasks",
      text: pluralize(tasks, "יצרתי משימה", `יצרתי ${tasks} משימות`),
    });
  }

  const documents = input.newDocuments ?? 0;
  if (documents > 0) {
    items.push({
      id: "documents",
      text: pluralize(documents, "זיהיתי מסמך חדש", `זיהיתי ${documents} מסמכים חדשים`),
    });
  }

  return {
    items: items.slice(0, 6),
    emptyMessage,
  };
}
