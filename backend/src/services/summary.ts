import { buildNatalieDailySummaryMessage } from "./whatsapp/natalieWhatsAppData.js";

export async function buildDailySummary(organizationId: string): Promise<string> {
  return buildNatalieDailySummaryMessage(organizationId);
}

export async function sendDailySummary(organizationId: string, period: "morning" | "evening") {
  const text = await buildDailySummary(organizationId);
  const { sendWhatsAppMessage } = await import("./whatsapp.js");
  await sendWhatsAppMessage(organizationId, text);
  const { prisma } = await import("../lib/prisma.js");
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
  const { prisma } = await import("../lib/prisma.js");
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
      const { formatSupplierDisplayName } = await import("./whatsapp/natalieWhatsAppUx.js");
      await prisma.alert.create({
        data: {
          organizationId,
          type: "upcoming_payment",
          title: `תשלום קרוב: ${formatSupplierDisplayName(p.supplier)}`,
          body: `₪${p.amount} — יעד ${p.dueDate?.toLocaleDateString("he-IL")}`,
        },
      });
    }
  }
}
