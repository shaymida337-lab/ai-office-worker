import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logCommunicationStage } from "./communicationLogging.js";
import type {
  CommunicationEnvelope,
  CommunicationEventRecord,
  CommunicationHistoryFilters,
  CommunicationHistoryResult,
  CreateCommunicationEventResult,
} from "./types.js";

const BODY_PREVIEW_MAX = 280;

export type CommunicationDb = {
  communicationEvent: {
    upsert(args: Prisma.CommunicationEventUpsertArgs): Promise<CommunicationEventRecord>;
    update(args: Prisma.CommunicationEventUpdateArgs): Promise<CommunicationEventRecord>;
    findMany(args: Prisma.CommunicationEventFindManyArgs): Promise<CommunicationEventRecord[]>;
    count(args: Prisma.CommunicationEventCountArgs): Promise<number>;
  };
};

export function bodyPreview(body: string | null | undefined, max = BODY_PREVIEW_MAX): string | null {
  if (!body) return null;
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function buildMetadata(envelope: CommunicationEnvelope, stage: string): Prisma.InputJsonValue {
  const base = envelope.metadata && typeof envelope.metadata === "object" ? { ...envelope.metadata } : {};
  const attachments = Array.isArray(envelope.attachments) ? envelope.attachments : [];
  return {
    ...base,
    stage,
    attachments,
    occurredAt: envelope.occurredAt ? new Date(envelope.occurredAt).toISOString() : undefined,
  } satisfies Prisma.InputJsonValue;
}

function toRecord(row: CommunicationEventRecord): CommunicationEventRecord {
  return row;
}

export class CommunicationService {
  constructor(private readonly db: CommunicationDb = prisma) {}

  async createCommunicationEvent(
    envelope: CommunicationEnvelope,
    options: { stage?: string } = {}
  ): Promise<CreateCommunicationEventResult> {
    const stage = options.stage ?? "created";
    const preview = bodyPreview(envelope.body);
    const metadataJson = buildMetadata(envelope, stage);

    const existing = await this.db.communicationEvent.findMany({
      where: {
        organizationId: envelope.organizationId,
        channel: envelope.channel,
        externalMessageId: envelope.externalMessageId,
      },
      take: 1,
    });
    const hadExisting = existing.length > 0;

    const event = await this.db.communicationEvent.upsert({
      where: {
        organizationId_channel_externalMessageId: {
          organizationId: envelope.organizationId,
          channel: envelope.channel,
          externalMessageId: envelope.externalMessageId,
        },
      },
      create: {
        organizationId: envelope.organizationId,
        channel: envelope.channel,
        direction: envelope.direction,
        externalMessageId: envelope.externalMessageId,
        correlationId: envelope.correlationId,
        sender: envelope.sender ?? null,
        recipient: envelope.recipient ?? null,
        subject: envelope.subject ?? null,
        bodyPreview: preview,
        metadataJson,
        sourceReference: envelope.sourceReference ?? null,
      },
      update: {
        correlationId: envelope.correlationId,
        direction: envelope.direction,
        sender: envelope.sender ?? null,
        recipient: envelope.recipient ?? null,
        subject: envelope.subject ?? null,
        bodyPreview: preview,
        metadataJson,
        sourceReference: envelope.sourceReference ?? null,
      },
    });

    logCommunicationStage({
      correlationId: envelope.correlationId,
      organizationId: envelope.organizationId,
      channel: envelope.channel,
      externalMessageId: envelope.externalMessageId,
      stage,
      eventId: event.id,
    });

    return { event: toRecord(event), created: !hadExisting };
  }

  async updateCommunicationEvent(
    organizationId: string,
    eventId: string,
    patch: {
      metadata?: Record<string, unknown>;
      stage?: string;
      bodyPreview?: string | null;
      sourceReference?: string | null;
    }
  ): Promise<CommunicationEventRecord> {
    const existing = await this.db.communicationEvent.findMany({
      where: { id: eventId, organizationId },
      take: 1,
    });
    if (!existing[0]) {
      throw new Error("CommunicationEvent not found");
    }

    const currentMeta =
      existing[0].metadataJson && typeof existing[0].metadataJson === "object"
        ? (existing[0].metadataJson as Record<string, unknown>)
        : {};
    const metadataJson = {
      ...currentMeta,
      ...(patch.metadata ?? {}),
      ...(patch.stage ? { stage: patch.stage } : {}),
    };

    const updated = await this.db.communicationEvent.update({
      where: { id: eventId },
      data: {
        bodyPreview: patch.bodyPreview === undefined ? undefined : patch.bodyPreview,
        sourceReference: patch.sourceReference === undefined ? undefined : patch.sourceReference,
        metadataJson,
      },
    });

    logCommunicationStage({
      correlationId: updated.correlationId,
      organizationId: updated.organizationId,
      channel: updated.channel,
      externalMessageId: updated.externalMessageId,
      stage: patch.stage ?? String(metadataJson.stage ?? "updated"),
      eventId: updated.id,
    });

    return toRecord(updated);
  }

  async loadCommunicationHistory(filters: CommunicationHistoryFilters): Promise<CommunicationHistoryResult> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: Prisma.CommunicationEventWhereInput = {
      organizationId: filters.organizationId,
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
      ...(filters.fromDate || filters.toDate
        ? {
            createdAt: {
              ...(filters.fromDate ? { gte: filters.fromDate } : {}),
              ...(filters.toDate ? { lte: filters.toDate } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.communicationEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.db.communicationEvent.count({ where }),
    ]);

    return {
      items: items.map(toRecord),
      total,
      offset,
      limit,
    };
  }
}

export const communicationService = new CommunicationService();
