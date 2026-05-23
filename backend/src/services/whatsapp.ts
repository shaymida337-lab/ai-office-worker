import { config, hasTwilio } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";

async function getTwilioClient() {
  if (!hasTwilio()) return null;
  const twilio = (await import("twilio")).default;
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

export async function sendWhatsAppMessage(organizationId: string, body: string) {
  const client = await getTwilioClient();
  if (!client || !config.twilio.ownerWhatsApp) return;

  await client.messages.create({
    from: config.twilio.whatsappFrom,
    to: config.twilio.ownerWhatsApp,
    body,
  });

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      direction: "outbound",
      body,
      toNumber: config.twilio.ownerWhatsApp,
      fromNumber: config.twilio.whatsappFrom,
    },
  });
}

export async function notifyNewInvoice(
  organizationId: string,
  supplier: string,
  amount: number | null
) {
  const msg = `🧾 חשבונית חדשה\nספק: ${supplier}\nסכום: ₪${amount ?? "לא זוהה"}`;
  await sendWhatsAppMessage(organizationId, msg);
}

export async function handleWhatsAppCommand(
  organizationId: string,
  body: string
): Promise<string> {
  const cmd = body.trim().toUpperCase();

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      direction: "inbound",
      body,
      fromNumber: config.twilio.ownerWhatsApp,
    },
  });

  switch (cmd) {
    case "HELP":
    case "עזרה":
      return `פקודות:\nSTATUS — מצב\nSUMMARY — סיכום\nSYNC — סריקת Gmail\nPAYMENTS — לשלם\nMISSING — חשבוניות חסרות`;
    case "STATUS":
    case "מצב": {
      const s = await getDashboardStats(organizationId);
      return `לשלם: ₪${s.moneyToPay}\nחסרות: ${s.missingInvoicesCount}\nמשימות: ${s.openTasks}`;
    }
    case "SUMMARY":
    case "סיכום": {
      const { buildDailySummary } = await import("./summary.js");
      return buildDailySummary(organizationId);
    }
    case "SYNC":
    case "סנכרון": {
      const { syncGmailForOrganization } = await import("./gmail-sync.js");
      const r = await syncGmailForOrganization(organizationId);
      return `סונכרן: ${r.emailsProcessed} מיילים, ${r.paymentsCreated} תשלומים חדשים`;
    }
    case "PAYMENTS":
    case "תשלומים": {
      const open = await prisma.supplierPayment.findMany({
        where: { organizationId, paid: false, paymentRequired: true },
        take: 10,
        orderBy: { dueDate: "asc" },
      });
      if (!open.length) return "אין תשלומים פתוחים";
      return open
        .map((p) => `• ${p.supplier} ₪${p.amount}${p.dueDate ? ` עד ${p.dueDate.toLocaleDateString("he-IL")}` : ""}`)
        .join("\n");
    }
    case "MISSING":
    case "חסרות": {
      const m = await prisma.supplierPayment.findMany({
        where: { organizationId, missingInvoice: true, paid: false },
        take: 10,
      });
      if (!m.length) return "אין חשבוניות חסרות";
      return m.map((p) => `• ${p.supplier} ₪${p.amount}`).join("\n");
    }
    default:
      return `לא הכרתי את הפקודה. שלח HELP`;
  }
}
