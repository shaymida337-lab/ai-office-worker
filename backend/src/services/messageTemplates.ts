export const ownerTemplates = {
  morningReport: (data: {
    activeClients: number;
    monthlyIncome: number;
    pendingPayments: number;
    newEmails: number;
    todayTasks: number;
    urgentClient?: string;
    urgentReason?: string;
  }) => `
☀️ *בוקר טוב! דוח יומי - AI Office Worker*

👥 לקוחות פעילים: ${data.activeClients}
💰 הכנסות החודש: ₪${data.monthlyIncome.toLocaleString("he-IL")}
⏳ ממתינים לתשלום: ${data.pendingPayments} לקוחות
📧 מיילים חדשים: ${data.newEmails}
✅ משימות להיום: ${data.todayTasks}
${data.urgentClient ? `\n🔴 *דחוף:* ${data.urgentClient} - ${data.urgentReason}` : ""}

_שלח "עזרה" לרשימת פקודות_
  `.trim(),

  criticalAlert: (data: { clientName: string; issue: string; action: string }) => `
🚨 *התראה דחופה*

לקוח: ${data.clientName}
בעיה: ${data.issue}
פעולה מומלצת: ${data.action}

_השב "בסדר" לאישור קריאה_
  `.trim(),

  weeklyReport: (data: { week: string; income: number; newClients: number; completedTasks: number; topClient: string }) => `
📊 *סיכום שבועי - ${data.week}*

💰 הכנסות השבוע: ₪${data.income.toLocaleString("he-IL")}
🆕 לקוחות חדשים: ${data.newClients}
✅ משימות שהושלמו: ${data.completedTasks}
⭐ לקוח מוביל: ${data.topClient}

_דוח מלא נשמר ב-Google Drive_
  `.trim(),
};

export const clientTemplates = {
  morningBrief: (data: { clientName: string; tasksToday: number; pendingInvoice?: number; tip?: string }) => `
☀️ *בוקר טוב ${data.clientName}!*

${data.tasksToday > 0 ? `📋 ${data.tasksToday} משימות להיום` : "✨ אין משימות דחופות היום"}
${data.pendingInvoice ? `💳 חשבונית פתוחה: ₪${data.pendingInvoice.toLocaleString("he-IL")}` : ""}
${data.tip ? `\n💡 ${data.tip}` : ""}

_שלח "מה יש לי?" לפרטים נוספים_
  `.trim(),

  invoiceFound: (data: { clientName: string; amount: number; from: string; savedTo: string }) => `
🧾 *חשבונית חדשה נמצאה*

מאת: ${data.from}
סכום: ₪${data.amount.toLocaleString("he-IL")}
נשמר ב: ${data.savedTo}

✅ הכל מסודר אוטומטית ב-Google Drive
  `.trim(),

  paymentReminder: (data: { clientName: string; invoiceNumber: string; amount: number; daysOverdue: number; paymentLink?: string }) => `
💳 *תזכורת תשלום*

שלום ${data.clientName},
חשבונית #${data.invoiceNumber}
סכום: ₪${data.amount.toLocaleString("he-IL")}
ימים מאז הפקה: ${data.daysOverdue}

${data.paymentLink ? `לתשלום: ${data.paymentLink}` : "נשמח לסגור 🙏"}
  `.trim(),

  urgentAlert: (data: { clientName: string; message: string }) => `
⚠️ *עדכון חשוב*

${data.message}

_להסרה מרשימת עדכונים השב "הסר"_
  `.trim(),
};
