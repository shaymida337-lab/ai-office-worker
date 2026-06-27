import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { CalendarEventStatus } from "./enums.js";

export type AppendAuditInput = {
  calendarEventId: string;
  organizationId: string;
  action: string;
  actorType: "user" | "system" | "natalie";
  actorUserId?: string | null;
  fromStatus?: CalendarEventStatus | null;
  toStatus?: CalendarEventStatus | null;
  changesJson?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

export async function appendCalendarEventAudit(input: AppendAuditInput) {
  const client = input.tx ?? prisma;
  return client.calendarEventAudit.create({
    data: {
      calendarEventId: input.calendarEventId,
      organizationId: input.organizationId,
      action: input.action,
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      changesJson: input.changesJson ?? undefined,
    },
  });
}
