import { config } from "../../lib/config.js";
import { prisma } from "../../lib/prisma.js";

export class CalendarEngineDisabledError extends Error {
  readonly code = "CALENDAR_ENGINE_DISABLED" as const;

  constructor(message: string) {
    super(message);
    this.name = "CalendarEngineDisabledError";
  }
}

export type CalendarEngineFlagSource = "global_disabled" | "org_disabled" | "enabled";

export type ResolvedCalendarEngineFlags = {
  readEnabled: boolean;
  writeEnabled: boolean;
  googleMirrorEnabled: boolean;
  source: CalendarEngineFlagSource;
};

function readFlag(name: "CALENDAR_ENGINE_V1_READ" | "CALENDAR_ENGINE_V1_WRITE"): boolean {
  const raw = process.env[name];
  if (raw !== undefined) {
    return raw.toLowerCase() === "true";
  }
  return name === "CALENDAR_ENGINE_V1_READ"
    ? config.calendarEngine.v1Read
    : config.calendarEngine.v1Write;
}

/** Global env kill switch — does not consider org flags. */
export function isGlobalCalendarEngineReadEnabled(): boolean {
  return readFlag("CALENDAR_ENGINE_V1_READ");
}

/** Global env kill switch — does not consider org flags. */
export function isGlobalCalendarEngineWriteEnabled(): boolean {
  return readFlag("CALENDAR_ENGINE_V1_WRITE");
}

/** @deprecated Prefer resolveCalendarEngineFlags(organizationId) when org context exists. */
export function isCalendarEngineReadEnabled(): boolean {
  return isGlobalCalendarEngineReadEnabled();
}

/** @deprecated Prefer resolveCalendarEngineFlags(organizationId) when org context exists. */
export function isCalendarEngineWriteEnabled(): boolean {
  return isGlobalCalendarEngineWriteEnabled();
}

export async function resolveCalendarEngineFlags(
  organizationId: string
): Promise<ResolvedCalendarEngineFlags> {
  const globalRead = isGlobalCalendarEngineReadEnabled();
  const globalWrite = isGlobalCalendarEngineWriteEnabled();

  if (!globalRead && !globalWrite) {
    return {
      readEnabled: false,
      writeEnabled: false,
      googleMirrorEnabled: false,
      source: "global_disabled",
    };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
    },
  });

  const orgRead = org?.calendarEngineReadEnabled ?? false;
  const orgWrite = org?.calendarEngineWriteEnabled ?? false;
  const orgGoogleMirror = org?.calendarEngineGoogleMirrorEnabled ?? false;

  const readEnabled = globalRead && orgRead;
  const writeEnabled = globalWrite && orgWrite;
  const googleMirrorEnabled = writeEnabled && orgGoogleMirror;

  if (!readEnabled && !writeEnabled) {
    return {
      readEnabled,
      writeEnabled,
      googleMirrorEnabled,
      source: "org_disabled",
    };
  }

  return {
    readEnabled,
    writeEnabled,
    googleMirrorEnabled,
    source: "enabled",
  };
}

export async function assertCalendarEngineRead(organizationId: string): Promise<void> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  if (!flags.readEnabled) {
    throw new CalendarEngineDisabledError("Calendar engine read is disabled");
  }
}

export async function assertCalendarEngineWrite(organizationId: string): Promise<void> {
  const flags = await resolveCalendarEngineFlags(organizationId);
  if (!flags.writeEnabled) {
    throw new CalendarEngineDisabledError("Calendar engine write is disabled");
  }
}
