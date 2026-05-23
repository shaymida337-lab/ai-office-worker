import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";

export async function buildDailySummary(organizationId: string): Promise<string> {
  const stats = await getDashboardStats(organizationId);
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: true },
  });

  const today = new Date().toLocaleDateString("he-IL", { timeZone: org?.timezone ?? "Asia/Jerusalem" });
  const missing = await prisma.supplierPayment.findMany({
    where: { organizationId, missingInvoice: true, paid: false },
    take: 5,
  });

  const lines = [
    `📋 סיכום יומי — AI Office Worker`,
    `📅 ${today}`,
    ``,
    `💳 לשלם: ₪${stats.moneyToPay.toLocaleString("he-IL")}`,
    `📄 חשבוניות ממתינות: ${stats.pendingInvoices}`,
    `⚠️ חשבוניות חסרות: ${stats.missingInvoicesCount}`,
    `⏰ תשלומים קרובים (7 ימים): ${stats.upcomingPaymentsCount}`,
    `✅ משימות פתוחות: ${stats.openTasks}`,
  ];

  if (missing.length > 0) {
    lines.push(``, `חסרות חשבוניות:`);
    for (const m of missing) {
      lines.push(`• ${m.supplier} — ₪${m.amount} (${m.subject ?? "ללא נושא"})`);
    }
  }

  return lines.join("\n");
}

export async function sendDailySummary(organizationId: string, period: "morning" | "evening") {
  const text = await buildDailySummary(organizationId);
  const prefix = period === "morning" ? "🌅 בוקר טוב!\n\n" : "🌆 סיכום ערב:\n\n";
  const { sendWhatsAppMessage } = await import("./whatsapp.js");
  await sendWhatsAppMessage(organizationId, prefix + text);
  await prisma.syncLog.create({
    data: {
      organizationId,
      type: period === "morning" ? "whatsapp_morning" : "whatsapp_evening",
      status: "success",
      finishedAt: new Date(),
    },
  });
}

export async function checkUpcomingPaymentAlerts(organizationId: string) {
  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const upcoming = await prisma.supplierPayment.findMany({
    where: {
      organizationId,
      paid: false,
      paymentRequired: true,
      dueDate: { gte: now, lte: in3days },
    },
  });

  for (const p of upcoming) {
    const exists = await prisma.alert.findFirst({
      where: {
        organizationId,
        type: "upcoming_payment",
        title: { contains: p.id },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });
    if (!exists) {
      await prisma.alert.create({
        data: {
          organizationId,
          type: "upcoming_payment",
          title: `תשלום קרוב: ${p.supplier}`,
          body: `₪${p.amount} — יעד ${p.dueDate?.toLocaleDateString("he-IL")}`,
        },
      });
    }
  }
}
