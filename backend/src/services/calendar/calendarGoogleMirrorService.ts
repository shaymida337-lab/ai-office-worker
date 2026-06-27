import { prisma } from "../../lib/prisma.js";
import {
  deleteCalendarEngineGoogleEvent,
  insertCalendarEngineGoogleEvent,
  updateCalendarEngineGoogleEvent,
} from "../google.js";
import { appendCalendarEventAudit } from "./auditWriter.js";
import { parseCalendarAutonomyJson } from "./calendarAutonomy.js";
import { resolveCalendarEngineFlags } from "./calendarEngineFlags.js";
import type { CalendarEventActor } from "./calendarEventMutations.js";
import {
  buildCalendarEngineGoogleEventBody,
  type CalendarEngineGoogleMirrorSource,
} from "./calendarGoogleMirrorPayload.js";
import { appendWorkCaseTimelineEntry } from "./timelineWriter.js";
import {
  summaryGoogleSyncFailed,
  summaryGoogleSyncSuccess,
} from "./timelineSummaries.js";

const MIRROR_EVENT_SELECT = {
  id: true,
  organizationId: true,
  workCaseId: true,
  status: true,
  title: true,
  startAt: true,
  endAt: true,
  timezone: true,
  locationType: true,
  address: true,
  internalNotes: true,
  completionNotes: true,
  prerequisitesJson: true,
  googleEventId: true,
  googleSyncStatus: true,
  client: { select: { name: true } },
  service: { select: { name: true } },
} as const;

type MirrorEventRecord = {
  id: string;
  organizationId: string;
  workCaseId: string;
  status: string;
  title: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  locationType: string | null;
  address: string | null;
  internalNotes: string | null;
  completionNotes: string | null;
  prerequisitesJson: unknown;
  googleEventId: string | null;
  googleSyncStatus: string;
  client: { name: string } | null;
  service: { name: string } | null;
};

export type CalendarGoogleMirrorDeps = {
  getCalendarClientForOrganization: typeof import("../google.js").getCalendarClientForOrganization;
  insertCalendarEngineGoogleEvent: typeof insertCalendarEngineGoogleEvent;
  updateCalendarEngineGoogleEvent: typeof updateCalendarEngineGoogleEvent;
  deleteCalendarEngineGoogleEvent: typeof deleteCalendarEngineGoogleEvent;
};

const defaultDeps: CalendarGoogleMirrorDeps = {
  getCalendarClientForOrganization: async (organizationId) => {
    const { getCalendarClientForOrganization } = await import("../google.js");
    return getCalendarClientForOrganization(organizationId);
  },
  insertCalendarEngineGoogleEvent,
  updateCalendarEngineGoogleEvent,
  deleteCalendarEngineGoogleEvent,
};

async function shouldSyncGoogleForOrganization(organizationId: string): Promise<boolean> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  if (!flags.googleMirrorEnabled) {
    return false;
  }

  const org = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { calendarAutonomyJson: true },
  });
  const autonomy = parseCalendarAutonomyJson(org?.calendarAutonomyJson);
  return autonomy.autoSyncGoogleOnConfirm;
}

async function loadMirrorEvent(
  organizationId: string,
  calendarEventId: string
): Promise<MirrorEventRecord | null> {
  return prisma.calendarEvent.findFirst({
    where: { id: calendarEventId, organizationId },
    select: MIRROR_EVENT_SELECT,
  });
}

function toMirrorSource(event: MirrorEventRecord): CalendarEngineGoogleMirrorSource {
  return {
    clientName: event.client?.name ?? null,
    serviceName: event.service?.name ?? null,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    locationType: event.locationType,
    address: event.address,
    internalNotes: event.internalNotes,
    completionNotes: event.completionNotes,
    prerequisitesJson: event.prerequisitesJson,
  };
}

async function recordMirrorSkipped(
  event: MirrorEventRecord,
  actor: CalendarEventActor,
  reason: "not_connected" | "disabled"
): Promise<void> {
  try {
    await prisma.calendarEvent.update({
      where: { id: event.id },
      data: {
        googleSyncStatus: "skipped",
        lastSyncedAt: new Date(),
      },
    });

    await appendCalendarEventAudit({
      calendarEventId: event.id,
      organizationId: event.organizationId,
      action: "google_sync",
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      changesJson: { outcome: "skipped", reason },
    });
  } catch (err) {
    console.error(
      "[calendar/google-mirror] failed to record skipped status",
      err instanceof Error ? err.message : err
    );
  }
}

async function recordMirrorOutcome(params: {
  event: MirrorEventRecord;
  actor: CalendarEventActor;
  success: boolean;
  operation: "create" | "update" | "delete";
  googleEventId?: string | null;
  errorMessage?: string;
}): Promise<void> {
  const { event, actor, success, operation } = params;

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: event.id },
      data: {
        ...(operation === "delete" && success
          ? { googleEventId: null, googleSyncStatus: "deleted" }
          : {
              ...(params.googleEventId ? { googleEventId: params.googleEventId } : {}),
              googleSyncStatus: success ? "synced" : "failed",
            }),
        lastSyncedAt: new Date(),
      },
    });

    await appendCalendarEventAudit({
      calendarEventId: event.id,
      organizationId: event.organizationId,
      action: "google_sync",
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      changesJson: {
        operation,
        outcome: success ? "success" : "failure",
        googleEventId: params.googleEventId ?? event.googleEventId,
        ...(params.errorMessage ? { error: params.errorMessage } : {}),
      },
      tx,
    });

    await appendWorkCaseTimelineEntry({
      organizationId: event.organizationId,
      workCaseId: event.workCaseId,
      calendarEventId: event.id,
      type: success ? "google_sync_success" : "google_sync_failed",
      summary: success
        ? summaryGoogleSyncSuccess(operation)
        : summaryGoogleSyncFailed(params.errorMessage),
      actor,
      metaJson: {
        operation,
        googleEventId: params.googleEventId ?? event.googleEventId,
        ...(params.errorMessage ? { error: params.errorMessage } : {}),
      },
      tx,
    });
  });
}

export async function mirrorCalendarEventToGoogleAfterConfirm(
  params: {
    organizationId: string;
    calendarEventId: string;
    actor: CalendarEventActor;
  },
  deps: CalendarGoogleMirrorDeps = defaultDeps
): Promise<void> {
  if (!(await shouldSyncGoogleForOrganization(params.organizationId))) {
    return;
  }

  const event = await loadMirrorEvent(params.organizationId, params.calendarEventId);
  if (!event || event.status !== "confirmed") {
    return;
  }

  const calendarClient = await deps.getCalendarClientForOrganization(params.organizationId);
  if (!calendarClient) {
    await recordMirrorSkipped(event, params.actor, "not_connected");
    return;
  }

  const requestBody = buildCalendarEngineGoogleEventBody(toMirrorSource(event));

  try {
    if (event.googleEventId) {
      const updated = await deps.updateCalendarEngineGoogleEvent(
        params.organizationId,
        event.googleEventId,
        requestBody
      );
      if (!updated) {
        await recordMirrorOutcome({
          event,
          actor: params.actor,
          success: false,
          operation: "update",
          googleEventId: event.googleEventId,
          errorMessage: "Google update failed",
        });
        return;
      }

      await recordMirrorOutcome({
        event,
        actor: params.actor,
        success: true,
        operation: "update",
        googleEventId: event.googleEventId,
      });
      return;
    }

    const googleEventId = await deps.insertCalendarEngineGoogleEvent(
      params.organizationId,
      requestBody
    );
    if (!googleEventId) {
      await recordMirrorOutcome({
        event,
        actor: params.actor,
        success: false,
        operation: "create",
        errorMessage: "Google create failed",
      });
      return;
    }

    await recordMirrorOutcome({
      event,
      actor: params.actor,
      success: true,
      operation: "create",
      googleEventId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordMirrorOutcome({
      event,
      actor: params.actor,
      success: false,
      operation: event.googleEventId ? "update" : "create",
      googleEventId: event.googleEventId,
      errorMessage: message,
    });
  }
}

export async function mirrorCalendarEventGoogleUpdateIfConfirmed(
  params: {
    organizationId: string;
    calendarEventId: string;
    actor: CalendarEventActor;
  },
  deps: CalendarGoogleMirrorDeps = defaultDeps
): Promise<void> {
  await mirrorCalendarEventToGoogleAfterConfirm(params, deps);
}

export async function removeCalendarEngineGoogleMirror(
  params: {
    organizationId: string;
    calendarEventId: string;
    actor: CalendarEventActor;
  },
  deps: CalendarGoogleMirrorDeps = defaultDeps
): Promise<void> {
  if (!(await shouldSyncGoogleForOrganization(params.organizationId))) {
    return;
  }

  const event = await loadMirrorEvent(params.organizationId, params.calendarEventId);
  if (!event?.googleEventId) {
    return;
  }

  const calendarClient = await deps.getCalendarClientForOrganization(params.organizationId);
  if (!calendarClient) {
    return;
  }

  try {
    const deleted = await deps.deleteCalendarEngineGoogleEvent(
      params.organizationId,
      event.googleEventId
    );
    await recordMirrorOutcome({
      event,
      actor: params.actor,
      success: deleted,
      operation: "delete",
      googleEventId: event.googleEventId,
      ...(deleted ? {} : { errorMessage: "Google delete failed" }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordMirrorOutcome({
      event,
      actor: params.actor,
      success: false,
      operation: "delete",
      googleEventId: event.googleEventId,
      errorMessage: message,
    });
  }
}

export async function runDecisionGoogleMirrorSideEffects(
  params: {
    organizationId: string;
    decisionType: string;
    executed: boolean;
    result?: Record<string, unknown>;
    actor: CalendarEventActor;
  },
  deps: CalendarGoogleMirrorDeps = defaultDeps
): Promise<void> {
  if (!params.executed) {
    return;
  }

  const calendarEventId =
    typeof params.result?.calendarEventId === "string" ? params.result.calendarEventId : null;
  const oldCalendarEventId =
    typeof params.result?.oldCalendarEventId === "string" ? params.result.oldCalendarEventId : null;

  switch (params.decisionType) {
    case "confirm_appointment":
    case "override_conflict":
      if (calendarEventId) {
        await mirrorCalendarEventToGoogleAfterConfirm(
          {
            organizationId: params.organizationId,
            calendarEventId,
            actor: params.actor,
          },
          deps
        );
      }
      break;
    case "cancel_appointment":
      if (calendarEventId) {
        await removeCalendarEngineGoogleMirror(
          {
            organizationId: params.organizationId,
            calendarEventId,
            actor: params.actor,
          },
          deps
        );
      }
      break;
    case "reschedule_appointment":
      if (oldCalendarEventId) {
        await removeCalendarEngineGoogleMirror(
          {
            organizationId: params.organizationId,
            calendarEventId: oldCalendarEventId,
            actor: params.actor,
          },
          deps
        );
      }
      break;
    default:
      break;
  }
}

export function scheduleDecisionGoogleMirrorSideEffects(params: {
  organizationId: string;
  decisionType: string;
  executed: boolean;
  result?: Record<string, unknown>;
  actor: CalendarEventActor;
}): void {
  void runDecisionGoogleMirrorSideEffects(params).catch((err) => {
    console.error(
      "[calendar/google-mirror] decision side effect failed",
      err instanceof Error ? err.message : err
    );
  });
}

export function scheduleCalendarEventGoogleMirrorOnConfirmed(params: {
  organizationId: string;
  calendarEventId: string;
  actor: CalendarEventActor;
}): void {
  void mirrorCalendarEventToGoogleAfterConfirm(params).catch((err) => {
    console.error(
      "[calendar/google-mirror] confirmed transition mirror failed",
      err instanceof Error ? err.message : err
    );
  });
}

export function scheduleCalendarEventGoogleUpdateIfConfirmed(params: {
  organizationId: string;
  calendarEventId: string;
  status: string;
  actor: CalendarEventActor;
}): void {
  if (params.status !== "confirmed") {
    return;
  }

  void mirrorCalendarEventGoogleUpdateIfConfirmed({
    organizationId: params.organizationId,
    calendarEventId: params.calendarEventId,
    actor: params.actor,
  }).catch((err) => {
    console.error(
      "[calendar/google-mirror] confirmed update mirror failed",
      err instanceof Error ? err.message : err
    );
  });
}
