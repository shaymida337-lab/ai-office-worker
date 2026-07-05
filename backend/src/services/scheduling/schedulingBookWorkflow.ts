import type { Prisma } from "@prisma/client";

import {
  APPOINTMENT_INCLUDE,
  AppointmentConflictError,
  checkAppointmentConflict,
  type AppointmentWithRelations,
} from "../appointmentService.js";
import { appointmentEnd } from "../calendar/engine.js";
import { createDraftCalendarEvent, submitCalendarEventForConfirmation } from "../calendar/calendarEventService.js";
import type { CalendarEventActor } from "../calendar/calendarEventMutations.js";
import { withOrganizationSchedulingLock } from "../calendar/schedulingLock.js";
import {
  formatAmbiguousCustomerMessage,
  resolveOrCreateSchedulingCustomerInTx,
  resolveSchedulingCustomerMatches,
} from "./schedulingCustomer.js";
import { SchedulingFacadeError } from "./schedulingErrors.js";

export type NatalieScheduleSlot = {
  organizationId: string;
  startTime: Date;
  durationMinutes: number;
  serviceId: string | null;
  timeZone: string;
};

export type NatalieScheduleCustomer = {
  clientName: string;
  clientId?: string;
  clientPhone?: string | null;
  clientEmail?: string | null;
  notes?: string | null;
  address?: string | null;
};

export async function assertSingleSchedulingCustomer(params: {
  organizationId: string;
  customer: NatalieScheduleCustomer;
}): Promise<void> {
  const matches = await resolveSchedulingCustomerMatches({
    organizationId: params.organizationId,
    name: params.customer.clientName,
    clientId: params.customer.clientId,
    phone: params.customer.clientPhone,
    email: params.customer.clientEmail,
  });

  if (matches.length > 1) {
    throw new SchedulingFacadeError("multiple_clients", formatAmbiguousCustomerMessage(params.customer.clientName, matches), {
      clients: matches,
    });
  }
}

export async function createLegacyAppointmentInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    clientId: string;
    serviceId?: string | null;
    startTime: Date;
    durationMinutes: number;
    notes?: string | null;
    source?: string;
  }
): Promise<AppointmentWithRelations> {
  const conflict = await checkAppointmentConflict({
    organizationId: params.organizationId,
    startTime: params.startTime,
    durationMinutes: params.durationMinutes,
  });
  if (conflict.hasConflict) {
    throw new AppointmentConflictError();
  }

  return tx.appointment.create({
    data: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      serviceId: params.serviceId ?? null,
      startTime: params.startTime,
      durationMinutes: params.durationMinutes,
      status: "pending",
      source: params.source ?? "natalie",
      notes: params.notes?.trim() || null,
    },
    include: APPOINTMENT_INCLUDE,
  });
}

export async function scheduleNatalieAppointmentAtomic(params: {
  organizationId: string;
  userId: string;
  slot: NatalieScheduleSlot;
  customer: NatalieScheduleCustomer;
  engineEnabled: boolean;
}): Promise<
  | { engine: false; appointment: AppointmentWithRelations; clientCreated: boolean }
  | {
      engine: true;
      calendarEventId: string;
      workCaseId: string;
      status: string;
      startTime: string;
      durationMinutes: number;
      clientId: string;
      clientCreated: boolean;
      confirmation: Awaited<ReturnType<typeof submitCalendarEventForConfirmation>>;
    }
> {
  const actor: CalendarEventActor = { actorType: "user", actorUserId: params.userId };

  return withOrganizationSchedulingLock(params.organizationId, async (tx) => {
    const { client, created, appointmentNotes } = await resolveOrCreateSchedulingCustomerInTx(tx, {
      organizationId: params.organizationId,
      name: params.customer.clientName,
      clientId: params.customer.clientId,
      phone: params.customer.clientPhone,
      email: params.customer.clientEmail,
      notes: params.customer.notes,
      address: params.customer.address,
    });

    if (!params.engineEnabled) {
      const appointment = await createLegacyAppointmentInTransaction(tx, {
        organizationId: params.organizationId,
        clientId: client.id,
        serviceId: params.slot.serviceId,
        startTime: params.slot.startTime,
        durationMinutes: params.slot.durationMinutes,
        notes: appointmentNotes,
        source: "natalie",
      });
      return { engine: false as const, appointment, clientCreated: created };
    }

    const endAt = appointmentEnd(params.slot.startTime, params.slot.durationMinutes);
    const event = await createDraftCalendarEvent(
      params.organizationId,
      {
        title: client.name,
        startAt: params.slot.startTime,
        endAt,
        timezone: params.slot.timeZone,
        clientId: client.id,
        serviceId: params.slot.serviceId,
        source: "ai_chat",
        createdByUserId: params.userId,
        workCaseTitle: `תיק יומן — ${client.name}`,
        address: params.customer.address?.trim() || null,
      },
      actor,
      { tx }
    );

    const confirmation = await submitCalendarEventForConfirmation(
      params.organizationId,
      event.id,
      actor,
      { tx }
    );

    return {
      engine: true as const,
      calendarEventId: event.id,
      workCaseId: event.workCaseId,
      status: confirmation.mode === "confirmed" ? confirmation.event.status : "pending_readiness",
      startTime: params.slot.startTime.toISOString(),
      durationMinutes: params.slot.durationMinutes,
      clientId: client.id,
      clientCreated: created,
      confirmation,
    };
  });
}
