import { prisma } from "../lib/prisma.js";
import { getCrmListKpis } from "./crm/crmCounts.js";
import { buildRealStaleLeadWhere } from "./crm/leadQuality.js";
import { assertOutboundEmailAllowed } from "./google.js";
import { buildNatalieLeadReminder, buildNatalieStaleLeadsBatch, NATALIE_BRAND } from "./whatsapp/natalieWhatsAppUx.js";
import { sendWhatsAppMessage, sendWhatsAppToPhone } from "./whatsapp.js";

export {
  countCrmActiveCustomers,
  countCrmNewLeads,
  countCrmOpenReminders,
  countCrmUnattended,
  getCrmListKpis,
} from "./crm/crmCounts.js";

export const LEAD_STAGES = ["חדש", "יצירת קשר", "בטיפול", "הצעת מחיר", "סגור", "הפסד"] as const;
export const LEAD_SOURCES = ["whatsapp", "email", "website", "referral", "manual", "facebook"] as const;

type LeadInput = {
  name?: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  source?: string | null;
  stage?: string | null;
  estimatedValue?: number | string | null;
  assignedTo?: string | null;
  tags?: string[] | string | null;
  notes?: string | null;
  nextReminderAt?: string | null;
  attachments?: string[] | null;
};

type LeadSortBy = "createdAt" | "updatedAt" | "estimatedValue" | "score" | "stage" | "source" | "name";
type NormalizedLeadInput = {
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  source: string;
  stage: string;
  estimatedValue: number;
  assignedTo: string | null;
  tags: string[];
  notes: string | null;
  nextReminderAt: Date | null;
  attachments: string[];
};

type LeadForScore = {
  source?: string | null;
  estimatedValue?: number | null;
  repliedAt?: Date | string | null;
  lastContactAt?: Date | string | null;
  createdAt?: Date | string | null;
  messageCount?: number | null;
};

const sequenceSteps = [
  { step: 1, minutes: 0, channel: "whatsapp", template: "FIRST_TOUCH" },
  { step: 2, minutes: 2 * 24 * 60, channel: "whatsapp", template: "FOLLOW_UP_1" },
  { step: 3, minutes: 5 * 24 * 60, channel: "email", template: "FOLLOW_UP_2" },
  { step: 4, minutes: 5 * 24 * 60, channel: "whatsapp", template: "FOLLOW_UP_2" },
  { step: 5, minutes: 10 * 24 * 60, channel: "whatsapp", template: "BREAKUP" },
];

const defaultTemplates = [
  {
    name: "FIRST_TOUCH",
    channel: "whatsapp",
    variables: ["שם", "שירות", "שם_עסק", "תחום", "מספר", "תוצאה", "שם_נציג"],
    content: `שלום {{שם}},

ראיתי שהתעניינת ב{{שירות}}.

אני {{שם_עסק}} - אנחנו מתמחים ב{{תחום}} ועזרנו למעל {{מספר}} עסקים כמוך להשיג {{תוצאה}}.

אשמח לשמוע מה אתם מחפשים ולראות איך נוכל לעזור.

מתי נוח לדבר 5 דקות?

{{שם_נציג}}`,
  },
  {
    name: "FOLLOW_UP_1",
    channel: "whatsapp",
    variables: ["שם", "עונה/תקופה", "סוג עסק דומה", "מדד", "אחוז"],
    content: `היי {{שם}},

שלחתי לך הודעה לפני יומיים - רציתי לוודא שקיבלת.

אנחנו עכשיו בעיצומו של {{עונה/תקופה}} ויש לנו מקום ל-2-3 לקוחות נוספים החודש.

אם תרצה לשמוע איך עזרנו ל{{סוג עסק דומה}} להגדיל את ה{{מדד}} ב-{{אחוז}}% - אשמח לספר.

נוח לדבר היום?`,
  },
  {
    name: "FOLLOW_UP_2",
    channel: "email",
    variables: ["שם", "שירות", "תוצאה", "זמן", "מחיר"],
    content: `{{שם}}, שלום שוב -

אני יודע שאתה עסוק, אז אגיד ישר לעניין:

אנחנו עושים {{שירות}}
הלקוחות שלנו מקבלים {{תוצאה}} תוך {{זמן}}
המחיר מתחיל מ-{{מחיר}}

אם זה רלוונטי - תגיד "כן" ואשלח פרטים.
אם לא - אין בעיה, לא אטריד יותר.`,
  },
  {
    name: "FOLLOW_UP_2",
    channel: "whatsapp",
    variables: ["שם", "שירות", "תוצאה", "זמן", "מחיר"],
    content: `{{שם}}, שלום שוב -

אני יודע שאתה עסוק, אז אגיד ישר לעניין:

אנחנו עושים {{שירות}}
הלקוחות שלנו מקבלים {{תוצאה}} תוך {{זמן}}
המחיר מתחיל מ-{{מחיר}}

אם זה רלוונטי - תגיד "כן" ואשלח פרטים.
אם לא - אין בעיה, לא אטריד יותר.`,
  },
  {
    name: "BREAKUP",
    channel: "whatsapp",
    variables: ["שם", "שם_נציג"],
    content: `שלום {{שם}},

ניסיתי ליצור איתך קשר כמה פעמים ולא שמעתי ממך.

אני מבין שאולי זה לא הזמן הנכון - אין בעיה בכלל.

אם בעתיד תרצה לחזור ולדבר, אני כאן.

בהצלחה!
{{שם_נציג}}`,
  },
];

export function scoreLead(lead: LeadForScore) {
  const now = Date.now();
  const createdAt = dateMs(lead.createdAt) ?? now;
  const lastContactAt = dateMs(lead.lastContactAt) ?? createdAt;
  const daysSinceContact = Math.floor((now - lastContactAt) / 86_400_000);
  const respondedWithin24h = Boolean(lead.repliedAt && dateMs(lead.repliedAt)! - createdAt <= 86_400_000);
  const estimatedValue = lead.estimatedValue ?? 0;
  const messageCount = lead.messageCount ?? 0;

  const score =
    (respondedWithin24h ? 20 : 0) +
    (estimatedValue > 5000 ? 25 : 10) +
    (lead.source === "referral" ? 20 : 5) +
    (messageCount > 3 ? 15 : 0) +
    (daysSinceContact < 2 ? 20 : daysSinceContact < 7 ? 10 : 0);

  return Math.max(1, Math.min(100, score));
}

export function scoreLabel(score: number) {
  if (score <= 40) return "קר";
  if (score <= 70) return "פושר";
  return "חם";
}

export async function listCrmLeads(organizationId: string, query: Record<string, unknown>) {
  const source = stringValue(query.source);
  const stage = stringValue(query.stage);
  const assignedTo = stringValue(query.assignedTo);
  const search = stringValue(query.search);
  const minValue = numberValue(query.minValue);
  const maxValue = numberValue(query.maxValue);
  const from = dateValue(query.from);
  const to = dateValue(query.to);
  const sortBy = leadSortBy(query.sortBy);
  const sortDir = stringValue(query.sortDir) === "asc" ? "asc" : "desc";
  const estimatedValueFilter = {
    ...(minValue !== null && { gte: minValue }),
    ...(maxValue !== null && { lte: maxValue }),
  };

  // List payload for /crm cards + filters + search only.
  // Do NOT include timeline/sequences here — those are loaded per lead via GET /leads/:id
  // when the profile panel opens (avoids N*relations bloat on every list fetch).
  const where = {
    organizationId,
    ...(source && source !== "all" && { source }),
    ...(stage && stage !== "all" && { stage }),
    ...(assignedTo && { assignedTo }),
    ...(Object.keys(estimatedValueFilter).length && { estimatedValue: estimatedValueFilter }),
    ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { company: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ],
    }),
  };

  const [leadRows, listKpis] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        id: true,
        name: true,
        company: true,
        phone: true,
        email: true,
        whatsapp: true,
        source: true,
        stage: true,
        estimatedValue: true,
        assignedTo: true,
        tags: true,
        notes: true,
        score: true,
        priorityStars: true,
        repliedAt: true,
        lastContactAt: true,
        nextReminderAt: true,
        lastMessageStatus: true,
        attachments: true,
        messageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ [sortBy]: sortDir }, { updatedAt: "desc" }],
      take: 300,
    }),
    // CRM KPI cards need full-org counts (not the take:300 slice).
    getCrmListKpis(organizationId),
  ]);

  const leads = leadRows.map((lead) => ({
    ...lead,
    timeline: [] as Array<{
      id: string;
      type: string;
      content: string;
      channel: string | null;
      createdAt: Date;
    }>,
    sequences: [] as Array<{
      id: string;
      step: number;
      channel: string;
      template: string;
      scheduledAt: Date;
      sentAt: Date | null;
      status: string;
    }>,
  }));

  // Legacy KPI fields (unused by /crm cards) derived from the returned list —
  // avoids a second round of heavy org-wide aggregates on every list load.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const replied = leadRows.filter((lead) => lead.repliedAt != null).length;
  const closed = leadRows.filter((lead) => lead.stage === "סגור");
  const avgCloseDays = closed.length
    ? Math.round(
        closed.reduce(
          (sum, lead) => sum + Math.max(0, lead.updatedAt.getTime() - lead.createdAt.getTime()) / 86_400_000,
          0
        ) / closed.length
      )
    : 0;

  return {
    leads,
    kpis: {
      newToday: leadRows.filter((lead) => lead.createdAt >= today).length,
      responseRate: leadRows.length ? Math.round((replied / leadRows.length) * 100) : 0,
      avgCloseDays,
      pipelineValue: leadRows
        .filter((lead) => lead.stage !== "הפסד")
        .reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0),
      activeCustomers: listKpis.activeCustomers,
      newLeads: listKpis.newLeads,
      openTasks: listKpis.openTasks,
      unattended: listKpis.unattended,
    },
    pipeline: buildPipeline(leads),
  };
}

export async function getCrmLead(organizationId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    include: { timeline: { orderBy: { createdAt: "desc" } }, sequences: { orderBy: { scheduledAt: "asc" } } },
  });
  if (!lead) throw new Error("Lead not found");
  return lead;
}

export async function createCrmLead(organizationId: string, input: LeadInput, createdBy?: string, startSequence = true) {
  const data = normalizeLeadInput(input, false);
  if (!data.name) throw new Error("Lead name is required");
  const initialScore = scoreLead({ ...data, createdAt: new Date(), lastContactAt: new Date() });

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      ...data,
      score: initialScore,
      priorityStars: starsFromScore(initialScore),
      lastContactAt: new Date(),
      timeline: {
        create: {
          type: "created",
          content: `ליד חדש נוצר ממקור ${data.source}`,
          channel: data.source,
          createdBy,
        },
      },
    },
  });

  await seedDefaultTemplates(organizationId);
  if (startSequence) await createLeadSequence(lead.id);
  await notifyAgent(organizationId, `ליד חדש הגיע: ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}`);
  return getCrmLead(organizationId, lead.id);
}

export async function updateCrmLead(organizationId: string, leadId: string, input: LeadInput & { stage?: string | null }, userId?: string) {
  const current = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!current) throw new Error("Lead not found");
  const data = normalizeLeadInput(input, true);
  const nextScore = scoreLead({ ...current, ...data });
  const stageChanged = data.stage && data.stage !== current.stage;

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...data,
      score: nextScore,
      priorityStars: starsFromScore(nextScore),
      ...(stageChanged && { lastContactAt: new Date() }),
      ...(stageChanged && {
        timeline: {
          create: {
            type: "stage_change",
            content: `השלב שונה מ-${current.stage} ל-${data.stage}`,
            createdBy: userId,
          },
        },
      }),
    },
  });

  if (stageChanged && lead.stage === "סגור") {
    await notifyAgent(organizationId, `הליד ${lead.name} עבר לסגור - ניצחון`);
  }

  return getCrmLead(organizationId, lead.id);
}

export async function addLeadTimeline(organizationId: string, leadId: string, input: { type?: string; content?: string; channel?: string }, userId?: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) throw new Error("Lead not found");
  if (!input.content?.trim()) throw new Error("Timeline content is required");

  const item = await prisma.leadTimeline.create({
    data: {
      leadId,
      type: input.type || "note",
      content: input.content.trim(),
      channel: input.channel,
      createdBy: userId,
    },
  });
  await recalculateLeadScore(organizationId, leadId);
  return item;
}

export async function handleLeadReply(organizationId: string, value: { phone?: string; email?: string; message?: string; channel?: string }) {
  const phone = value.phone?.trim();
  const email = value.email?.trim();
  const lead = await prisma.lead.findFirst({
    where: {
      organizationId,
      OR: [
        ...(phone ? [{ phone }, { whatsapp: phone }] : []),
        ...(email ? [{ email }] : []),
      ],
    },
  });
  if (!lead) return null;

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      repliedAt: new Date(),
      stage: lead.stage === "חדש" || lead.stage === "יצירת קשר" ? "בטיפול" : lead.stage,
      lastMessageStatus: "ענה",
      lastContactAt: new Date(),
      messageCount: { increment: 1 },
    },
  });
  await prisma.leadSequence.updateMany({ where: { leadId: lead.id, status: "pending" }, data: { status: "paused" } });
  await prisma.leadTimeline.create({
    data: {
      leadId: lead.id,
      type: "reply",
      content: value.message || "הליד ענה",
      channel: value.channel || (phone ? "whatsapp" : "email"),
    },
  });
  await recalculateLeadScore(organizationId, lead.id);
  await notifyAgent(organizationId, `הליד ${lead.name} ענה! הודעה: "${value.message ?? ""}"`);
  return getCrmLead(organizationId, lead.id);
}

export async function processLeadSequences() {
  const pending = await prisma.leadSequence.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: new Date() },
      lead: { repliedAt: null },
    },
    include: { lead: { include: { organization: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 100,
  });

  let sent = 0;
  const errors: string[] = [];
  for (const sequence of pending) {
    try {
      const message = await buildSequenceMessage(sequence.lead.organizationId, sequence.lead, sequence.template, sequence.channel);
      if (sequence.channel === "whatsapp") {
        const phone = sequence.lead.whatsapp || sequence.lead.phone;
        if (!phone) throw new Error("Lead phone is missing");
        const result = await sendWhatsAppToPhone(sequence.lead.organizationId, phone, message, undefined, true);
        if (!result.sent) throw new Error(result.reason || "WhatsApp send failed");
      } else if (sequence.channel === "email") {
        if (!sequence.lead.email) throw new Error("Lead email is missing");
        await sendLeadEmail(sequence.lead.organizationId, sequence.lead.email, "המשך לשיחה שלנו", message);
      }
      await prisma.leadSequence.update({ where: { id: sequence.id }, data: { status: "sent", sentAt: new Date(), messageTemplate: message } });
      await prisma.leadTimeline.create({
        data: { leadId: sequence.leadId, type: "message", channel: sequence.channel, content: message },
      });
      await prisma.lead.update({
        where: { id: sequence.leadId },
        data: { lastContactAt: new Date(), lastMessageStatus: "נשלח", messageCount: { increment: 1 } },
      });
      sent++;
    } catch (err) {
      errors.push(`${sequence.id}: ${errorMessage(err)}`);
      await prisma.leadSequence.update({ where: { id: sequence.id }, data: { status: "paused" } });
    }
  }

  return { sent, errors };
}

export async function processCrmNotifications() {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const reminderSoon = new Date(now.getTime() + 60 * 60 * 1000);
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let created = 0;

  for (const org of orgs) {
    const staleWhere = buildRealStaleLeadWhere(org.id, staleThreshold);
    const [staleLeadCount, _staleLeadPreview, upcomingReminders] = await Promise.all([
      prisma.lead.count({ where: staleWhere }),
      prisma.lead.findMany({
        where: staleWhere,
        take: 20,
        orderBy: { lastContactAt: "asc" },
      }),
      prisma.lead.findMany({
        where: {
          organizationId: org.id,
          nextReminderAt: { gte: now, lte: reminderSoon },
          stage: { notIn: ["סגור", "הפסד"] },
        },
        take: 20,
        orderBy: { nextReminderAt: "asc" },
      }),
    ]);

    if (staleLeadCount > 0) {
      const message = buildNatalieStaleLeadsBatch(staleLeadCount);
      const wasCreated = await notifyAgentOnce(org.id, "crm_stale_lead", message);
      if (wasCreated) created++;
    }

    for (const lead of upcomingReminders) {
      const when = lead.nextReminderAt?.toLocaleString("he-IL") ?? "";
      const message = buildNatalieLeadReminder({ leadName: lead.name, when });
      const wasCreated = await notifyAgentOnce(org.id, "crm_reminder", message);
      if (wasCreated) created++;
    }
  }

  return { created };
}

export async function seedDefaultTemplates(organizationId: string) {
  await Promise.all(defaultTemplates.map((template) =>
    prisma.messageTemplate.upsert({
      where: { organizationId_name_channel: { organizationId, name: template.name, channel: template.channel } },
      create: { organizationId, ...template },
      update: { content: template.content, variables: template.variables },
    })
  ));
}

export async function listMessageTemplates(organizationId: string) {
  await seedDefaultTemplates(organizationId);
  return prisma.messageTemplate.findMany({
    where: { organizationId },
    orderBy: [{ channel: "asc" }, { name: "asc" }],
  });
}

export async function updateMessageTemplate(organizationId: string, id: string, input: { content?: string }) {
  const template = await prisma.messageTemplate.findFirst({ where: { id, organizationId } });
  if (!template) throw new Error("Template not found");
  if (!input.content?.trim()) throw new Error("Template content is required");
  return prisma.messageTemplate.update({
    where: { id },
    data: { content: input.content.trim() },
  });
}

export async function createLeadFromUnknownWhatsApp(organizationId: string, phone: string, message: string) {
  const existing = await prisma.lead.findFirst({ where: { organizationId, OR: [{ phone }, { whatsapp: phone }] } });
  if (existing) {
    return handleLeadReply(organizationId, { phone, message, channel: "whatsapp" });
  }
  return createCrmLead(organizationId, { name: phone, phone, whatsapp: phone, source: "whatsapp", notes: message }, undefined, true);
}

export async function getCrmKpis(organizationId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [newToday, all, replied, pipeline, closed, listKpis] = await Promise.all([
    prisma.lead.count({ where: { organizationId, createdAt: { gte: today } } }),
    prisma.lead.count({ where: { organizationId } }),
    prisma.lead.count({ where: { organizationId, repliedAt: { not: null } } }),
    prisma.lead.aggregate({ where: { organizationId, stage: { notIn: ["הפסד"] } }, _sum: { estimatedValue: true } }),
    prisma.lead.findMany({ where: { organizationId, stage: "סגור" }, select: { createdAt: true, updatedAt: true } }),
    getCrmListKpis(organizationId),
  ]);
  const avgCloseDays = closed.length
    ? Math.round(closed.reduce((sum, lead) => sum + Math.max(0, lead.updatedAt.getTime() - lead.createdAt.getTime()) / 86_400_000, 0) / closed.length)
    : 0;
  return {
    newToday,
    responseRate: all ? Math.round((replied / all) * 100) : 0,
    avgCloseDays,
    pipelineValue: pipeline._sum.estimatedValue ?? 0,
    /** Same DB counts CRM KPI cards + dashboard home must use (not list slice). */
    activeCustomers: listKpis.activeCustomers,
    newLeads: listKpis.newLeads,
    openTasks: listKpis.openTasks,
    unattended: listKpis.unattended,
  };
}

function buildPipeline(leads: Array<{ stage: string; estimatedValue: number }>) {
  const totals = new Map<string, { stage: string; count: number; value: number; conversionFromPrevious: number }>();
  for (const stage of LEAD_STAGES) totals.set(stage, { stage, count: 0, value: 0, conversionFromPrevious: 100 });
  for (const lead of leads) {
    const current = totals.get(lead.stage) ?? totals.get("חדש")!;
    current.count++;
    current.value += lead.estimatedValue;
  }
  const rows = [...totals.values()];
  for (let index = 1; index < rows.length; index += 1) {
    rows[index].conversionFromPrevious = rows[index - 1].count ? Math.round((rows[index].count / rows[index - 1].count) * 100) : 0;
  }
  return rows;
}

async function createLeadSequence(leadId: string) {
  const now = Date.now();
  await prisma.leadSequence.createMany({
    data: sequenceSteps.map((step) => ({
      leadId,
      step: step.step,
      channel: step.channel,
      template: step.template,
      scheduledAt: new Date(now + step.minutes * 60_000),
      status: "pending",
    })),
  });
}

async function buildSequenceMessage(organizationId: string, lead: { name: string; company: string | null }, templateName: string, channel: string) {
  await seedDefaultTemplates(organizationId);
  const template = await prisma.messageTemplate.findUnique({
    where: { organizationId_name_channel: { organizationId, name: templateName, channel } },
  });
  const content = template?.content ?? defaultTemplates.find((item) => item.name === templateName && item.channel === channel)?.content ?? "";
  return content
    .replaceAll("{{שם}}", lead.name)
    .replaceAll("{{שירות}}", "השירות שלכם")
    .replaceAll("{{שם_עסק}}", NATALIE_BRAND)
    .replaceAll("{{תחום}}", "אוטומציה עסקית")
    .replaceAll("{{מספר}}", "עשרות")
    .replaceAll("{{תוצאה}}", "יותר פניות וסדר במכירות")
    .replaceAll("{{שם_נציג}}", "הצוות")
    .replaceAll("{{עונה/תקופה}}", "התקופה הקרובה")
    .replaceAll("{{סוג עסק דומה}}", lead.company || "עסק דומה")
    .replaceAll("{{מדד}}", "כמות הפניות")
    .replaceAll("{{אחוז}}", "30")
    .replaceAll("{{זמן}}", "30 יום")
    .replaceAll("{{מחיר}}", "שיחה קצרה להתאמה");
}

async function notifyAgent(organizationId: string, message: string) {
  await prisma.alert.create({
    data: {
      organizationId,
      type: "crm",
      title: "CRM",
      body: message,
    },
  });
  await sendWhatsAppMessage(organizationId, message).catch(() => undefined);
}

async function notifyAgentOnce(organizationId: string, type: string, message: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.alert.findFirst({
    where: {
      organizationId,
      type,
      body: message,
      createdAt: { gte: since },
    },
  });
  if (existing) return false;
  await prisma.alert.create({
    data: {
      organizationId,
      type,
      title: "CRM",
      body: message,
    },
  });
  await sendWhatsAppMessage(organizationId, message).catch(() => undefined);
  return true;
}

async function recalculateLeadScore(organizationId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) return null;
  const score = scoreLead(lead);
  return prisma.lead.update({ where: { id: leadId, organizationId }, data: { score, priorityStars: starsFromScore(score) } });
}

function normalizeLeadInput(input: LeadInput, partial: true): Partial<NormalizedLeadInput>;
function normalizeLeadInput(input: LeadInput, partial?: false): NormalizedLeadInput;
function normalizeLeadInput(input: LeadInput, partial = false) {
  const data: Record<string, unknown> = {};

  if (!partial || input.name !== undefined) data.name = input.name?.trim() || "";
  if (!partial || input.company !== undefined) data.company = nullable(input.company);
  if (!partial || input.phone !== undefined) data.phone = nullable(input.phone);
  if (!partial || input.email !== undefined) data.email = nullable(input.email);
  if (!partial || input.whatsapp !== undefined || input.phone !== undefined) data.whatsapp = nullable(input.whatsapp ?? input.phone);
  if (!partial || input.assignedTo !== undefined) data.assignedTo = nullable(input.assignedTo);
  if (!partial || input.notes !== undefined) data.notes = nullable(input.notes);
  if (!partial || input.attachments !== undefined) data.attachments = input.attachments ?? [];

  if (!partial || input.tags !== undefined) {
    data.tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => tag.trim()).filter(Boolean)
    : typeof input.tags === "string"
      ? input.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];
  }

  if (!partial || input.estimatedValue !== undefined) data.estimatedValue = numberValue(input.estimatedValue) ?? 0;
  if (!partial || input.stage !== undefined) data.stage = input.stage && LEAD_STAGES.includes(input.stage as typeof LEAD_STAGES[number]) ? input.stage : "חדש";
  if (!partial || input.source !== undefined) data.source = input.source && LEAD_SOURCES.includes(input.source as typeof LEAD_SOURCES[number]) ? input.source : "manual";
  if (!partial || input.nextReminderAt !== undefined) {
    const nextReminderAt = input.nextReminderAt ? new Date(input.nextReminderAt) : null;
    data.nextReminderAt = nextReminderAt && !Number.isNaN(nextReminderAt.getTime()) ? nextReminderAt : null;
  }

  return data;
}

function leadSortBy(value: unknown): LeadSortBy {
  const sortBy = stringValue(value);
  return ["createdAt", "updatedAt", "estimatedValue", "score", "stage", "source", "name"].includes(sortBy)
    ? sortBy as LeadSortBy
    : "updatedAt";
}

function starsFromScore(score: number) {
  return Math.max(1, Math.min(5, Math.ceil(score / 20)));
}

function nullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateMs(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function emailDomain(value: string) {
  return value.split("@")[1]?.trim().toLowerCase() || "unknown";
}

async function sendLeadEmail(organizationId: string, to: string, subject: string, body: string) {
  assertOutboundEmailAllowed({
    provider: "gmail",
    feature: "crm_lead_email",
    organizationId,
    recipientDomain: emailDomain(to),
  });
  const { getGoogleClients } = await import("./google.js");
  const { gmail } = await getGoogleClients(organizationId);
  const raw = Buffer.from(
    [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n"),
    "utf8"
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
