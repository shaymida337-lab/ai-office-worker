import type { Prisma, WorkCaseStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { assertCalendarEngineRead, assertCalendarEngineWrite } from "./calendarEngineFlags.js";
import { isCalendarEventTerminal } from "./calendarEventLifecycle.js";
import type { CalendarEventStatus } from "./enums.js";
import { forbidden, notFound } from "./serviceErrors.js";
import { appendWorkCaseTimelineEntry } from "./timelineWriter.js";
import {
  summaryWorkCaseCreated,
  summaryWorkCaseStatusChanged,
} from "./timelineSummaries.js";
import {
  assertWorkCaseTransition,
  validateWorkCaseTransition,
} from "./workCaseLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";

export type WorkCaseActor = {
  actorType: "user" | "system" | "natalie";
  actorUserId?: string | null;
};

const WORK_CASE_INCLUDE = {
  client: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true, email: true } },
} as const;

export type WorkCaseWithRelations = Prisma.WorkCaseGetPayload<{ include: typeof WORK_CASE_INCLUDE }>;

async function requireWorkCase(organizationId: string, workCaseId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const workCase = await client.workCase.findFirst({
    where: { id: workCaseId, organizationId },
    include: WORK_CASE_INCLUDE,
  });
  if (!workCase) throw notFound("WorkCase");
  return workCase;
}

async function countOpenCalendarEvents(
  organizationId: string,
  workCaseId: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx ?? prisma;
  const events = await client.calendarEvent.findMany({
    where: { organizationId, workCaseId },
    select: { status: true },
  });
  return events.filter((event) => !isCalendarEventTerminal(event.status as CalendarEventStatus)).length;
}

async function countOpenTasks(
  organizationId: string,
  workCaseId: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx ?? prisma;
  return client.task.count({
    where: { organizationId, workCaseId, status: "open" },
  });
}

export async function createWorkCase(
  organizationId: string,
  input: {
    title: string;
    clientId?: string | null;
    leadId?: string | null;
    assignedUserId?: string | null;
    description?: string | null;
    priority?: string | null;
    source?: string;
  },
  actor: WorkCaseActor
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  return prisma.$transaction(async (tx) => {
    const workCase = await tx.workCase.create({
      data: {
        organizationId,
        title: input.title.trim(),
        clientId: input.clientId ?? null,
        leadId: input.leadId ?? null,
        assignedUserId: input.assignedUserId ?? null,
        description: input.description ?? null,
        priority: input.priority ?? null,
        source: input.source ?? "calendar",
      },
      include: WORK_CASE_INCLUDE,
    });

    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId: workCase.id,
      type: "work_case_created",
      summary: summaryWorkCaseCreated(workCase.title),
      actor,
      tx,
    });

    return workCase;
  });
}

export async function getWorkCaseById(
  organizationId: string,
  workCaseId: string
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineRead(organizationId);
  return requireWorkCase(organizationId, workCaseId);
}

export async function attachWorkCaseClient(
  organizationId: string,
  workCaseId: string,
  clientId: string | null,
  actor: WorkCaseActor
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineWrite(organizationId);
  await requireWorkCase(organizationId, workCaseId);

  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!client) throw notFound("Client");
  }

  return prisma.workCase.update({
    where: { id: workCaseId },
    data: { clientId },
    include: WORK_CASE_INCLUDE,
  });
}

export async function attachWorkCaseLead(
  organizationId: string,
  workCaseId: string,
  leadId: string | null,
  actor: WorkCaseActor
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineWrite(organizationId);
  await requireWorkCase(organizationId, workCaseId);

  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      select: { id: true },
    });
    if (!lead) throw notFound("Lead");
  }

  return prisma.workCase.update({
    where: { id: workCaseId },
    data: { leadId },
    include: WORK_CASE_INCLUDE,
  });
}

export async function attachWorkCaseUser(
  organizationId: string,
  workCaseId: string,
  assignedUserId: string | null,
  actor: WorkCaseActor
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineWrite(organizationId);
  await requireWorkCase(organizationId, workCaseId);

  if (assignedUserId) {
    const user = await prisma.user.findFirst({
      where: { id: assignedUserId, organization: { id: organizationId } },
      select: { id: true },
    });
    if (!user) throw notFound("User");
  }

  return prisma.workCase.update({
    where: { id: workCaseId },
    data: { assignedUserId },
    include: WORK_CASE_INCLUDE,
  });
}

export async function transitionWorkCaseStatus(
  organizationId: string,
  workCaseId: string,
  toStatus: WorkCaseStatus,
  actor: WorkCaseActor,
  options?: { allowManualClose?: boolean; closedReason?: string | null }
): Promise<WorkCaseWithRelations> {
  await assertCalendarEngineWrite(organizationId);

  return prisma.$transaction(async (tx) => {
    const workCase = await requireWorkCase(organizationId, workCaseId, tx);
    const fromStatus = workCase.status;

    validateWorkCaseTransition(fromStatus, toStatus, {
      openCalendarEventCount: await countOpenCalendarEvents(organizationId, workCaseId, tx),
      openTaskCount: await countOpenTasks(organizationId, workCaseId, tx),
      allowManualClose: options?.allowManualClose,
    });

    const updated = await tx.workCase.update({
      where: { id: workCaseId },
      data: {
        status: toStatus,
        closedAt: toStatus === "completed" || toStatus === "cancelled" ? new Date() : null,
        closedReason: options?.closedReason ?? null,
      },
      include: WORK_CASE_INCLUDE,
    });

    await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId,
      type: "status_changed",
      summary: summaryWorkCaseStatusChanged(fromStatus, toStatus),
      actor,
      metaJson: { entity: "work_case", fromStatus, toStatus },
      tx,
    });

    return updated;
  });
}

export async function setWorkCaseInvoiceDraftRequested(
  organizationId: string,
  workCaseId: string,
  actor: WorkCaseActor,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? prisma;
  const workCase = await client.workCase.findFirst({
    where: { id: workCaseId, organizationId },
    select: { id: true },
  });
  if (!workCase) throw notFound("WorkCase");

  await client.workCase.update({
    where: { id: workCaseId },
    data: { invoiceDraftRequested: true },
  });
}

export { assertWorkCaseTransition, LifecycleError };
