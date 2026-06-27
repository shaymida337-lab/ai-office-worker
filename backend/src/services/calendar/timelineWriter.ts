import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { TimelineEntryType } from "./enums.js";

export type TimelineActor = {
  actorType: "user" | "system" | "natalie";
  actorUserId?: string | null;
};

export type AppendTimelineInput = {
  organizationId: string;
  workCaseId: string;
  calendarEventId?: string | null;
  type: TimelineEntryType;
  summary: string;
  actor: TimelineActor;
  metaJson?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

export async function appendWorkCaseTimelineEntry(input: AppendTimelineInput) {
  const client = input.tx ?? prisma;
  return client.workCaseTimelineEntry.create({
    data: {
      organizationId: input.organizationId,
      workCaseId: input.workCaseId,
      calendarEventId: input.calendarEventId ?? null,
      type: input.type,
      summary: input.summary,
      actorType: input.actor.actorType,
      actorUserId: input.actor.actorUserId ?? null,
      metaJson: input.metaJson ?? undefined,
    },
  });
}
