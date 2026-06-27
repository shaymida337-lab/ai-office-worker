import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  resolveCalendarEngineFlags,
} from "../services/calendar/calendarEngineFlags.js";
import {
  checkCalendarEventConflict,
  completeCalendarEvent,
  createDraftCalendarEvent,
  getCalendarEventById,
  markCalendarEventNoShow,
  markCalendarEventPrerequisitePassed,
  requestCalendarEventCancel,
  requestCalendarEventReschedule,
  submitCalendarEventForConfirmation,
  updateCalendarEventFields,
} from "../services/calendar/calendarEventService.js";
import {
  approveDecisionQueueItem,
  getDecisionQueueItemById,
  rejectDecisionQueueItem,
} from "../services/calendar/decisionQueueService.js";
import {
  isDecisionQueueStatus,
  isWorkCaseStatus,
  type WorkCaseStatus,
} from "../services/calendar/enums.js";
import { createWorkCase, getWorkCaseById } from "../services/calendar/workCaseService.js";
import { appendWorkCaseTimelineEntry } from "../services/calendar/timelineWriter.js";
import { sendCalendarEngineError, sendCalendarEngineSuccess } from "./calendarEngineErrors.js";
import {
  CalendarEngineValidationError,
  parseClientEventSource,
  parseCompletionOutcome,
  parseDateRangeQuery,
  parseIsoDateTime,
  parseNonEmptyString,
  parseOptionalString,
  parsePaginationLimit,
  pickAllowedPatchFields,
  rejectOrganizationIdInBody,
  validateEventTimeRange,
} from "./calendarEngineValidation.js";

export const calendarEngineRouter = Router();

function requireCalendarEngineRead(req: Request, res: Response, next: NextFunction) {
  void resolveCalendarEngineFlags(req.auth!.organizationId)
    .then((flags) => {
      if (!flags.readEnabled) {
        res.status(503).json({
          error: "מנוע היומן אינו פעיל כרגע",
          code: "CALENDAR_ENGINE_DISABLED",
        });
        return;
      }
      next();
    })
    .catch(next);
}

function requireCalendarEngineWrite(req: Request, res: Response, next: NextFunction) {
  void resolveCalendarEngineFlags(req.auth!.organizationId)
    .then((flags) => {
      if (!flags.writeEnabled) {
        res.status(503).json({
          error: "מנוע היומן אינו פעיל כרגע",
          code: "CALENDAR_ENGINE_DISABLED",
        });
        return;
      }
      next();
    })
    .catch(next);
}

function actorFromRequest(req: Request) {
  return {
    actorType: "user" as const,
    actorUserId: req.auth!.userId,
  };
}

function routeParam(value: string | string[], fieldName: string): string {
  return parseNonEmptyString(Array.isArray(value) ? value[0] : value, fieldName);
}

function handleRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      sendCalendarEngineError(res, err);
    }
  };
}

calendarEngineRouter.get(
  "/work-cases",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !isWorkCaseStatus(status)) {
      throw new CalendarEngineValidationError("VALIDATION_FAILED", "Invalid work case status", {
        field: "status",
      });
    }

    const limit = parsePaginationLimit(req.query.limit);
    const workCaseStatus: WorkCaseStatus | undefined =
      status && isWorkCaseStatus(status) ? status : undefined;

    const workCases = await prisma.workCase.findMany({
      where: {
        organizationId,
        ...(workCaseStatus ? { status: workCaseStatus } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    sendCalendarEngineSuccess(res, 200, workCases);
  })
);

calendarEngineRouter.post(
  "/work-cases",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const workCase = await createWorkCase(
      organizationId,
      {
        title: parseNonEmptyString(body.title, "title"),
        clientId: body.clientId === undefined ? undefined : (parseOptionalString(body.clientId) ?? null),
        leadId: body.leadId === undefined ? undefined : (parseOptionalString(body.leadId) ?? null),
        assignedUserId:
          body.assignedUserId === undefined ? undefined : (parseOptionalString(body.assignedUserId) ?? null),
        description: parseOptionalString(body.description),
        priority: parseOptionalString(body.priority),
      },
      actorFromRequest(req)
    );

    sendCalendarEngineSuccess(res, 201, workCase);
  })
);

calendarEngineRouter.get(
  "/work-cases/:id",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const workCase = await getWorkCaseById(req.auth!.organizationId, routeParam(req.params.id, "id"));
    sendCalendarEngineSuccess(res, 200, workCase);
  })
);

calendarEngineRouter.get(
  "/work-cases/:id/timeline",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const workCaseId = routeParam(req.params.id, "id");
    await getWorkCaseById(organizationId, workCaseId);

    const limit = parsePaginationLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor.trim() ? req.query.cursor.trim() : undefined;

    const entries = await prisma.workCaseTimelineEntry.findMany({
      where: {
        organizationId,
        workCaseId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = entries.length > limit;
    const items = hasMore ? entries.slice(0, limit) : entries;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    sendCalendarEngineSuccess(res, 200, {
      items,
      nextCursor,
      hasMore,
    });
  })
);

calendarEngineRouter.post(
  "/work-cases/:id/notes",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const workCaseId = routeParam(req.params.id, "id");
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    await getWorkCaseById(organizationId, workCaseId);
    const note = parseNonEmptyString(body.note, "note");

    const entry = await appendWorkCaseTimelineEntry({
      organizationId,
      workCaseId,
      type: "note_added",
      summary: note,
      actor: actorFromRequest(req),
    });

    sendCalendarEngineSuccess(res, 201, entry);
  })
);

calendarEngineRouter.post(
  "/calendar/events/check-conflicts",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const startAt = parseIsoDateTime(body.startAt, "startAt");
    const endAt = parseIsoDateTime(body.endAt, "endAt");
    validateEventTimeRange(startAt, endAt);

    const result = await checkCalendarEventConflict({
      organizationId,
      startAt,
      endAt,
      excludeCalendarEventId: parseOptionalString(body.excludeCalendarEventId) ?? undefined,
      assignedUserId:
        body.assignedUserId === undefined ? undefined : (parseOptionalString(body.assignedUserId) ?? null),
    });

    sendCalendarEngineSuccess(res, 200, result);
  })
);

calendarEngineRouter.get(
  "/calendar/events",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const { from, to } = parseDateRangeQuery(req.query.from, req.query.to);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = parsePaginationLimit(req.query.limit);

    const events = await prisma.calendarEvent.findMany({
      where: {
        organizationId,
        startAt: { gte: from, lt: to },
        ...(status ? { status: status as never } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        service: { select: { id: true, name: true, durationMinutes: true } },
        workCase: { select: { id: true, title: true, status: true } },
      },
      orderBy: { startAt: "asc" },
      take: limit,
    });

    sendCalendarEngineSuccess(res, 200, events);
  })
);

calendarEngineRouter.post(
  "/calendar/events",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const startAt = parseIsoDateTime(body.startAt, "startAt");
    const endAt = parseIsoDateTime(body.endAt, "endAt");
    validateEventTimeRange(startAt, endAt);

    const event = await createDraftCalendarEvent(
      organizationId,
      {
        title: parseOptionalString(body.title),
        startAt,
        endAt,
        timezone: parseOptionalString(body.timezone) ?? undefined,
        workCaseId: parseOptionalString(body.workCaseId) ?? undefined,
        workCaseTitle: parseOptionalString(body.workCaseTitle) ?? undefined,
        clientId: body.clientId === undefined ? undefined : (parseOptionalString(body.clientId) ?? null),
        leadId: body.leadId === undefined ? undefined : (parseOptionalString(body.leadId) ?? null),
        assignedUserId:
          body.assignedUserId === undefined ? undefined : (parseOptionalString(body.assignedUserId) ?? null),
        serviceId: body.serviceId === undefined ? undefined : (parseOptionalString(body.serviceId) ?? null),
        source: parseClientEventSource(body.source),
        createdByUserId: req.auth!.userId,
        prerequisitesJson: Array.isArray(body.prerequisitesJson) ? body.prerequisitesJson : undefined,
      },
      actorFromRequest(req)
    );

    sendCalendarEngineSuccess(res, 201, event);
  })
);

calendarEngineRouter.get(
  "/calendar/events/:id",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const event = await getCalendarEventById(req.auth!.organizationId, routeParam(req.params.id, "id"));
    sendCalendarEngineSuccess(res, 200, event);
  })
);

calendarEngineRouter.patch(
  "/calendar/events/:id",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const patch = pickAllowedPatchFields(body);
    if (patch.startAt && patch.endAt) {
      validateEventTimeRange(patch.startAt, patch.endAt);
    } else if (patch.startAt || patch.endAt) {
      const existing = await getCalendarEventById(organizationId, routeParam(req.params.id, "id"));
      const startAt = patch.startAt ?? existing.startAt;
      const endAt = patch.endAt ?? existing.endAt;
      validateEventTimeRange(startAt, endAt);
    }

    const updated = await updateCalendarEventFields(
      organizationId,
      routeParam(req.params.id, "id"),
      patch,
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, updated);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/submit-for-confirmation",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const result = await submitCalendarEventForConfirmation(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, result);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/request-cancel",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const result = await requestCalendarEventCancel(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      actorFromRequest(req),
      { reason: parseOptionalString(body.reason) }
    );
    sendCalendarEngineSuccess(res, 200, result);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/request-reschedule",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const startAt = parseIsoDateTime(body.startAt, "startAt");
    const endAt = parseIsoDateTime(body.endAt, "endAt");
    validateEventTimeRange(startAt, endAt);

    const result = await requestCalendarEventReschedule(
      organizationId,
      routeParam(req.params.id, "id"),
      { startAt, endAt, reason: parseOptionalString(body.reason) },
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, result);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/complete",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const event = await completeCalendarEvent(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      {
        completionNotes: parseNonEmptyString(body.completionNotes, "completionNotes"),
        completionOutcome: parseCompletionOutcome(body.completionOutcome),
      },
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, event);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/no-show",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const event = await markCalendarEventNoShow(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      { notes: parseNonEmptyString(body.notes ?? body.completionNotes, "notes") },
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, event);
  })
);

calendarEngineRouter.post(
  "/calendar/events/:id/prerequisites/:itemId/pass",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const calendarEventId = routeParam(req.params.id, "id");
    const prerequisiteId = routeParam(req.params.itemId, "itemId");

    const existing = await getCalendarEventById(organizationId, calendarEventId);
    const prerequisites = Array.isArray(existing.prerequisitesJson) ? existing.prerequisitesJson : [];
    const found = prerequisites.some(
      (item) => typeof item === "object" && item && "id" in item && String((item as { id: unknown }).id) === prerequisiteId
    );
    if (!found) {
      throw new CalendarEngineValidationError("VALIDATION_FAILED", "Prerequisite item not found", {
        field: "itemId",
        itemId: prerequisiteId,
      });
    }

    const event = await markCalendarEventPrerequisitePassed(
      organizationId,
      calendarEventId,
      prerequisiteId,
      actorFromRequest(req)
    );
    sendCalendarEngineSuccess(res, 200, event);
  })
);

calendarEngineRouter.get(
  "/owner-decisions",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    if (!isDecisionQueueStatus(status)) {
      throw new CalendarEngineValidationError("VALIDATION_FAILED", "Invalid decision status", {
        field: "status",
      });
    }

    const limit = parsePaginationLimit(req.query.limit);
    const items = await prisma.ownerDecisionQueueItem.findMany({
      where: { organizationId, status: status as never },
      include: {
        workCase: { select: { id: true, title: true } },
        calendarEvent: {
          select: { id: true, status: true, title: true, startAt: true, endAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    sendCalendarEngineSuccess(res, 200, items);
  })
);

calendarEngineRouter.get(
  "/owner-decisions/:id",
  requireCalendarEngineRead,
  handleRoute(async (req, res) => {
    const item = await getDecisionQueueItemById(req.auth!.organizationId, routeParam(req.params.id, "id"));
    sendCalendarEngineSuccess(res, 200, item);
  })
);

calendarEngineRouter.post(
  "/owner-decisions/:id/approve",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const result = await approveDecisionQueueItem(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      actorFromRequest(req),
      {
        resolvedByUserId: req.auth!.userId,
        resolutionNote: parseOptionalString(body.resolutionNote),
      }
    );
    sendCalendarEngineSuccess(res, 200, result);
  })
);

calendarEngineRouter.post(
  "/owner-decisions/:id/reject",
  requireCalendarEngineWrite,
  handleRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    rejectOrganizationIdInBody(body);

    const item = await rejectDecisionQueueItem(
      req.auth!.organizationId,
      routeParam(req.params.id, "id"),
      actorFromRequest(req),
      {
        resolvedByUserId: req.auth!.userId,
        resolutionNote: parseOptionalString(body.resolutionNote),
      }
    );
    sendCalendarEngineSuccess(res, 200, item);
  })
);
