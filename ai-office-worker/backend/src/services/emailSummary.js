const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');
const { sendWhatsApp } = require('./twilioService');

const prisma = new PrismaClient();

const STATUS_HE = {
  NEW: 'חדש',
  PAID: 'שולם',
  OVERDUE: 'באיחור',
  NEEDS_REVIEW: 'דורש בדיקה',
  MISSING_INVOICE: 'חסרה חשבונית',
};

/**
 * Send daily digest email to a user.
 */
const sendDailySummary = async (user) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  // Gather stats
  const [
    newToday,
    overdueCount,
    needsReview,
    upcomingPayments,
    totalDue,
  ] = await Promise.all([
    prisma.document.count({
      where: { userId: user.id, createdAt: { gte: today } },
    }),
    prisma.document.count({
      where: { userId: user.id, status: 'OVERDUE' },
    }),
    prisma.document.count({
      where: { userId: user.id, status: 'NEEDS_REVIEW' },
    }),
    prisma.document.findMany({
      where: {
        userId: user.id,
        paymentDueDate: { gte: today, lte: nextWeek },
        status: { notIn: ['PAID'] },
      },
      orderBy: { paymentDueDate: 'asc' },
    }),
    prisma.document.aggregate({
      where: {
        userId: user.id,
        status: { in: ['NEW', 'OVERDUE', 'NEEDS_REVIEW'] },
        totalAmount: { not: null },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  const totalDueAmount = totalDue._sum.totalAmount || 0;

  const upcomingRows = upcomingPayments.map(doc => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${doc.vendorName || 'לא ידוע'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${doc.totalAmount?.toLocaleString('he-IL') || '-'} ${doc.currency || 'ILS'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${doc.paymentDueDate ? new Date(doc.paymentDueDate).toLocaleDateString('he-IL') : '-'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${STATUS_HE[doc.status] || doc.status}</td>
    </tr>
  `).join('');

  const sheetsLink = user.sheetsId
    ? `https://docs.google.com/spreadsheets/d/${user.sheetsId}`
    : null;

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:0; background:#f5f5f5; direction:rtl; }
  .wrap { max-width:600px; margin:24px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
  .header { background:#1a4b8c; color:#fff; padding:28px 32px; }
  .header h1 { margin:0 0 4px; font-size:22px; }
  .header p { margin:0; opacity:0.8; font-size:14px; }
  .stats { display:flex; flex-wrap:wrap; gap:0; }
  .stat { flex:1; min-width:140px; padding:20px; text-align:center; border-left:1px solid #f0f0f0; }
  .stat:last-child { border-left:none; }
  .stat .num { font-size:32px; font-weight:700; color:#1a4b8c; }
  .stat .label { font-size:12px; color:#888; margin-top:4px; }
  .section { padding:24px 32px; border-top:1px solid #f0f0f0; }
  .section h2 { margin:0 0 16px; font-size:16px; color:#333; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { background:#f8f8f8; padding:8px 12px; text-align:right; font-weight:600; color:#555; border-bottom:2px solid #eee; }
  .btn { display:inline-block; background:#1a4b8c; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-size:14px; margin-top:8px; }
  .footer { padding:20px 32px; text-align:center; color:#aaa; font-size:12px; background:#fafafa; border-top:1px solid #f0f0f0; }
  .alert { background:#fff3e0; border-right:4px solid #ff9800; padding:12px 16px; border-radius:4px; margin-bottom:12px; font-size:14px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>☀️ סיכום יומי - עובד משרד AI</h1>
    <p>שלום ${user.displayName || user.email} • ${today.toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>

  <div class="stats">
    <div class="stat"><div class="num">${newToday}</div><div class="label">מסמכים חדשים היום</div></div>
    <div class="stat"><div class="num">${overdueCount}</div><div class="label">מסמכים באיחור</div></div>
    <div class="stat"><div class="num">${needsReview}</div><div class="label">דורשים בדיקה</div></div>
    <div class="stat"><div class="num">₪${Math.round(totalDueAmount).toLocaleString('he-IL')}</div><div class="label">סה"כ לתשלום</div></div>
  </div>

  ${overdueCount > 0 ? `<div class="section"><div class="alert">⚠️ יש לך ${overdueCount} מסמכים שעבר תאריך תשלומם. בדוק בהקדם.</div></div>` : ''}

  ${upcomingPayments.length > 0 ? `
  <div class="section">
    <h2>📅 תשלומים השבוע</h2>
    <table>
      <thead><tr><th>ספק</th><th>סכום</th><th>תאריך לתשלום</th><th>סטטוס</th></tr></thead>
      <tbody>${upcomingRows}</tbody>
    </table>
  </div>` : ''}

  <div class="section" style="text-align:center">
    ${sheetsLink ? `<a href="${sheetsLink}" class="btn">📊 פתח את הטבלה</a>` : ''}
  </div>

  <div class="footer">
    עובד משרד AI לעסק קטן • הסיכום נשלח אוטומטית כל יום בשעה 08:00<br>
    לביטול עדכונים, היכנס להגדרות המערכת
  </div>
</div>
</body>
</html>`;

  await sendEmail(user.email, `☀️ סיכום יומי - ${today.toLocaleDateString('he-IL')}`, html);

  logger.info('Daily summary sent', { userId: user.id, email: user.email });

  await prisma.log.create({
    data: {
      userId: user.id,
      level: 'INFO',
      action: 'DAILY_SUMMARY_SENT',
      message: `Daily summary email sent to ${user.email}`,
      metadata: { newToday, overdueCount, needsReview, totalDueAmount },
    },
  });
};

/**
 * Send a short evening WhatsApp summary if user has a phone configured.
 */
const sendEveningSummary = async (user) => {
  try {
    const overdueCount = await prisma.document.count({ where: { userId: user.id, status: 'OVERDUE' } });
    const needsReview = await prisma.document.count({ where: { userId: user.id, status: 'NEEDS_REVIEW' } });
    const totalDue = await prisma.document.aggregate({
      where: { userId: user.id, status: { in: ['NEW', 'OVERDUE', 'NEEDS_REVIEW'] }, totalAmount: { not: null } },
      _sum: { totalAmount: true },
    });

    const totalDueAmount = totalDue._sum.totalAmount || 0;

    const msg = `סיכום ערב: ${overdueCount} באיחור, ${needsReview} דורש בדיקה, סה"כ לתשלום ₪${Math.round(totalDueAmount)}`;

    if (user.whatsappNumber) {
      await sendWhatsApp(user.whatsappNumber, msg);
      await prisma.log.create({ data: { userId: user.id, level: 'INFO', action: 'EVENING_WHATSAPP_SENT', message: msg } });
      logger.info('Evening WhatsApp sent', { userId: user.id });
    } else {
      logger.info('User has no whatsappNumber configured; skipping evening WhatsApp', { userId: user.id });
    }
  } catch (err) {
    logger.error('sendEveningSummary failed', { userId: user.id, error: err.message });
  }
};

const sendEmail = async (to, subject, html) => {
  // Using Gmail SMTP via OAuth or a transactional service
  // For MVP: configure via SMTP env vars
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"עובד משרד AI" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};

module.exports = { sendDailySummary, sendEveningSummary };
