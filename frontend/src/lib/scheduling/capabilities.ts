import { apiFetch } from "@/lib/api";
import {
  isCalendarEngineReadEnabled as isUiKillSwitchReadEnabled,
  isCalendarEngineWriteEnabled as isUiKillSwitchWriteEnabled,
} from "@/lib/calendarEngine/flags";

export type SchedulingCapabilities = {
  calendarEngineReadEnabled: boolean;
  calendarEngineWriteEnabled: boolean;
  ownerDecisionQueueEnabled: boolean;
  googleMirrorEnabled: boolean;
  source?: "global_disabled" | "org_disabled" | "enabled";
};

export async function fetchSchedulingCapabilities(): Promise<SchedulingCapabilities> {
  return apiFetch<SchedulingCapabilities>("/api/scheduling/capabilities");
}

/** UI kill switch AND backend org/global effective flags. */
export function effectiveCalendarEngineRead(
  capabilities: SchedulingCapabilities | null,
  uiKillSwitch = isUiKillSwitchReadEnabled()
): boolean {
  return uiKillSwitch && (capabilities?.calendarEngineReadEnabled ?? false);
}

/** UI kill switch AND backend org/global effective flags. */
export function effectiveCalendarEngineWrite(
  capabilities: SchedulingCapabilities | null,
  uiKillSwitch = isUiKillSwitchWriteEnabled()
): boolean {
  return uiKillSwitch && (capabilities?.calendarEngineWriteEnabled ?? false);
}

export function effectiveOwnerDecisionQueueEnabled(
  capabilities: SchedulingCapabilities | null,
  uiKillSwitch = isUiKillSwitchReadEnabled()
): boolean {
  return uiKillSwitch && (capabilities?.ownerDecisionQueueEnabled ?? false);
}
