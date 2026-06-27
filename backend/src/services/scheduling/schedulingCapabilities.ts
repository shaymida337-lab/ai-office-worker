import { resolveCalendarEngineFlags } from "../calendar/calendarEngineFlags.js";

export type SchedulingCapabilitiesResponse = {
  calendarEngineReadEnabled: boolean;
  calendarEngineWriteEnabled: boolean;
  ownerDecisionQueueEnabled: boolean;
  googleMirrorEnabled: boolean;
  source: "global_disabled" | "org_disabled" | "enabled";
};

export async function getSchedulingCapabilities(
  organizationId: string
): Promise<SchedulingCapabilitiesResponse> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  return {
    calendarEngineReadEnabled: flags.readEnabled,
    calendarEngineWriteEnabled: flags.writeEnabled,
    ownerDecisionQueueEnabled: flags.readEnabled,
    googleMirrorEnabled: flags.googleMirrorEnabled,
    source: flags.source,
  };
}
