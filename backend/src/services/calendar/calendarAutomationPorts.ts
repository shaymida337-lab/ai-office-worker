import type { CalendarEngineRequestContext } from "./calendarEngineTypes.js";

/** Future WhatsApp scheduling hook — not wired in Phase C. */
export type WhatsAppSchedulingPort = {
  onInboundScheduleRequest(params: {
    organizationId: string;
    phone: string;
    message: string;
    ctx: CalendarEngineRequestContext;
  }): Promise<{ handled: boolean }>;
};

/** Future automation scheduling hook — not wired in Phase C. */
export type AutomationSchedulingPort = {
  onAutomationTrigger(params: {
    organizationId: string;
    triggerId: string;
    payload: Record<string, unknown>;
    ctx: CalendarEngineRequestContext;
  }): Promise<{ handled: boolean }>;
};

export const NoOpWhatsAppSchedulingPort: WhatsAppSchedulingPort = {
  async onInboundScheduleRequest() {
    return { handled: false };
  },
};

export const NoOpAutomationSchedulingPort: AutomationSchedulingPort = {
  async onAutomationTrigger() {
    return { handled: false };
  },
};
