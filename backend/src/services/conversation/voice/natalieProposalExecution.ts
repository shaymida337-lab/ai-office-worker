import {
  INVOICE_DRAFT_SAVED_CONFIRMATION_MESSAGE,
  saveInvoiceDraft,
  validateInvoiceDraftInput,
} from "../../outgoingInvoiceDraft.js";
import { completeTask, createTask } from "../../tasks.js";
import {
  bookAppointmentViaNatalie,
  cancelAppointmentViaNatalie,
  rescheduleAppointmentViaNatalie,
  type NatalieBookResult,
  type NatalieCancelResult,
  type NatalieRescheduleResult,
} from "../../scheduling/schedulingFacade.js";

export type NatalieProposalExecutionResult = {
  ok: boolean;
  action: string;
  message: string;
  payload?: unknown;
};

function resolveSchedulingItemId(proposal: Record<string, unknown>): string {
  if (typeof proposal.schedulingItemId === "string" && proposal.schedulingItemId.trim()) {
    return proposal.schedulingItemId.trim();
  }
  if (typeof proposal.appointmentId === "string" && proposal.appointmentId.trim()) {
    return proposal.appointmentId.trim();
  }
  return "";
}

function resolveBookMessage(result: NatalieBookResult, clientName: string): string {
  if (result.engine) return result.message;
  const name = result.appointment.client?.name ?? clientName;
  return `התור נקבע עבור ${name}.`;
}

function resolveCancelMessage(result: NatalieCancelResult): string {
  if (result.engine) return result.message;
  const name = result.appointment.client?.name;
  return name ? `התור של ${name} בוטל.` : "התור בוטל.";
}

function resolveRescheduleMessage(result: NatalieRescheduleResult): string {
  if (result.engine) return result.message;
  const name = result.appointment.client?.name;
  return name ? `התור של ${name} עודכן.` : "התור עודכן.";
}

export async function executeNataliePendingProposal(input: {
  organizationId: string;
  userId: string;
  action: string;
  proposal: Record<string, unknown>;
}): Promise<NatalieProposalExecutionResult> {
  switch (input.action) {
    case "create_task": {
      const title = typeof input.proposal.title === "string" ? input.proposal.title.trim() : "";
      const notes = typeof input.proposal.notes === "string" ? input.proposal.notes.trim() : "";
      const dueDate =
        typeof input.proposal.dueDate === "string" && input.proposal.dueDate.trim()
          ? new Date(input.proposal.dueDate)
          : null;
      if (!title) {
        return { ok: false, action: input.action, message: "חסרה כותרת למשימה." };
      }
      const task = await createTask({
        organizationId: input.organizationId,
        title,
        description: notes || null,
        dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
        source: "natalie",
        status: "open",
      });
      return { ok: true, action: input.action, message: `המשימה "${task.title}" נוצרה.`, payload: task };
    }
    case "complete_task": {
      const taskId = typeof input.proposal.taskId === "string" ? input.proposal.taskId.trim() : "";
      if (!taskId) {
        return { ok: false, action: input.action, message: "חסר מזהה משימה." };
      }
      const task = await completeTask({ organizationId: input.organizationId, taskId });
      if (!task) {
        return { ok: false, action: input.action, message: "לא מצאתי את המשימה." };
      }
      return { ok: true, action: input.action, message: `המשימה "${task.title}" סומנה כבוצעה.`, payload: task };
    }
    case "issue_invoice": {
      const validation = validateInvoiceDraftInput(input.proposal);
      if (!validation.ok) {
        return { ok: false, action: input.action, message: "פרטי הטיוטה לא תקינים." };
      }
      const draft = await saveInvoiceDraft({
        organizationId: input.organizationId,
        draft: validation.value,
      });
      return {
        ok: true,
        action: input.action,
        message: INVOICE_DRAFT_SAVED_CONFIRMATION_MESSAGE,
        payload: draft,
      };
    }
    case "book_appointment": {
      const clientName = typeof input.proposal.clientName === "string" ? input.proposal.clientName : "";
      const result = await bookAppointmentViaNatalie({
        organizationId: input.organizationId,
        userId: input.userId,
        clientName,
        clientId: typeof input.proposal.clientId === "string" ? input.proposal.clientId : undefined,
        clientPhone: typeof input.proposal.clientPhone === "string" ? input.proposal.clientPhone : undefined,
        clientEmail: typeof input.proposal.clientEmail === "string" ? input.proposal.clientEmail : undefined,
        address: typeof input.proposal.address === "string" ? input.proposal.address : undefined,
        dayReference: typeof input.proposal.dayReference === "string" ? input.proposal.dayReference : undefined,
        time: typeof input.proposal.time === "string" ? input.proposal.time : undefined,
        startTime: typeof input.proposal.startTime === "string" ? input.proposal.startTime : undefined,
        durationMinutes:
          typeof input.proposal.durationMinutes === "number" && Number.isFinite(input.proposal.durationMinutes)
            ? input.proposal.durationMinutes
            : undefined,
        serviceName: typeof input.proposal.serviceName === "string" ? input.proposal.serviceName : undefined,
        notes: typeof input.proposal.notes === "string" ? input.proposal.notes : undefined,
      });
      return {
        ok: true,
        action: input.action,
        message: resolveBookMessage(result, clientName),
        payload: result,
      };
    }
    case "cancel_appointment": {
      const schedulingItemId = resolveSchedulingItemId(input.proposal);
      if (!schedulingItemId) {
        return { ok: false, action: input.action, message: "חסר מזהה תור." };
      }
      const result = await cancelAppointmentViaNatalie({
        organizationId: input.organizationId,
        userId: input.userId,
        schedulingItemId,
      });
      return {
        ok: true,
        action: input.action,
        message: resolveCancelMessage(result),
        payload: result,
      };
    }
    case "reschedule_appointment": {
      const schedulingItemId = resolveSchedulingItemId(input.proposal);
      if (!schedulingItemId) {
        return { ok: false, action: input.action, message: "חסר מזהה תור." };
      }
      const result = await rescheduleAppointmentViaNatalie({
        organizationId: input.organizationId,
        userId: input.userId,
        schedulingItemId,
        newDayReference:
          typeof input.proposal.newDayReference === "string" ? input.proposal.newDayReference : undefined,
        newTime: typeof input.proposal.newTime === "string" ? input.proposal.newTime : undefined,
        newStartTime:
          typeof input.proposal.newStartTime === "string"
            ? input.proposal.newStartTime
            : typeof input.proposal.newWhen === "string"
              ? input.proposal.newWhen
              : undefined,
      });
      return {
        ok: true,
        action: input.action,
        message: resolveRescheduleMessage(result),
        payload: result,
      };
    }
    default:
      return {
        ok: false,
        action: input.action,
        message: "לא ניתן לבצע את הפעולה הזו בקול כרגע.",
      };
  }
}
