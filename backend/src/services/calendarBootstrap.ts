/**
 * Calendar First Paint bootstrap — meta only (no events list).
 * No Google API, no unbounded findMany, single organization lookup.
 */
import { prisma } from "../lib/prisma.js";
import {
  resolveCalendarEngineFlagsFromOrg,
  type CalendarEngineOrgFlagsRow,
} from "./calendar/calendarEngineFlags.js";
import type { SchedulingCapabilitiesResponse } from "./scheduling/schedulingCapabilities.js";

export const CALENDAR_BOOTSTRAP_MAX_PAYLOAD_BYTES = 100 * 1024;
export const CALENDAR_BOOTSTRAP_EMPLOYEES_LIMIT = 100;
export const CALENDAR_BOOTSTRAP_SERVICES_LIMIT = 100;
export const CALENDAR_BOOTSTRAP_CLIENTS_LIMIT = 200;

export type CalendarBootstrapSettings = {
  timezone: string;
  workday: { weekStart: string };
  locale: string;
};

export type CalendarBootstrapEmployee = {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
};

export type CalendarBootstrapService = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  color: string | null;
  isActive: boolean;
  employeeIds: string[];
};

export type CalendarBootstrapClientSummary = {
  id: string;
  name: string;
  phone: string | null;
};

export type CalendarBootstrapConnectionStatus = {
  connected: boolean;
  calendarId?: string;
};

export type CalendarBootstrapPayload = {
  capabilities: SchedulingCapabilitiesResponse;
  connectionStatus: CalendarBootstrapConnectionStatus;
  settings: CalendarBootstrapSettings;
  employees: CalendarBootstrapEmployee[];
  services: CalendarBootstrapService[];
  clientsSummary: CalendarBootstrapClientSummary[];
  generatedAt: string;
};

export type CalendarBootstrapTiming = {
  organizationMs: number;
  metaWaveMs: number;
  serializeMs: number;
  totalMs: number;
  organizationLookupCount: number;
  queryGroupCount: number;
};

export type GetCalendarBootstrapOptions = {
  collectTiming?: boolean;
  onTiming?: (timing: CalendarBootstrapTiming) => void;
  now?: Date;
};

async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

function calendarIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const calendarId = (metadata as { calendarId?: unknown }).calendarId;
  return typeof calendarId === "string" && calendarId.trim() ? calendarId.trim() : null;
}

async function loadBootstrapOrganization(organizationId: string): Promise<{
  timezone: string;
  locale: string;
  weekStart: string;
  flags: CalendarEngineOrgFlagsRow;
}> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      locale: true,
      weekStart: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
    },
  });
  if (!organization) throw new Error("Organization not found");

  return {
    timezone: organization.timezone?.trim() || "Asia/Jerusalem",
    locale: organization.locale?.trim() || "he-IL",
    weekStart: organization.weekStart?.trim() || "sunday",
    flags: {
      calendarEngineReadEnabled: organization.calendarEngineReadEnabled,
      calendarEngineWriteEnabled: organization.calendarEngineWriteEnabled,
      calendarEngineGoogleMirrorEnabled: organization.calendarEngineGoogleMirrorEnabled,
    },
  };
}

function capabilitiesFromFlags(flags: CalendarEngineOrgFlagsRow): SchedulingCapabilitiesResponse {
  const resolved = resolveCalendarEngineFlagsFromOrg(flags);
  return {
    calendarEngineReadEnabled: resolved.readEnabled,
    calendarEngineWriteEnabled: resolved.writeEnabled,
    ownerDecisionQueueEnabled: resolved.readEnabled,
    googleMirrorEnabled: resolved.googleMirrorEnabled,
    source: resolved.source,
  };
}

async function loadEmployeesSlim(organizationId: string): Promise<CalendarBootstrapEmployee[]> {
  const rows = await prisma.employee.findMany({
    where: { organizationId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: CALENDAR_BOOTSTRAP_EMPLOYEES_LIMIT,
    select: { id: true, name: true, color: true, isActive: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isActive: row.isActive,
  }));
}

async function loadServicesSlim(organizationId: string): Promise<CalendarBootstrapService[]> {
  const rows = await prisma.service.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    take: CALENDAR_BOOTSTRAP_SERVICES_LIMIT,
    select: {
      id: true,
      name: true,
      durationMinutes: true,
      price: true,
      color: true,
      isActive: true,
      employeeLinks: { select: { employeeId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    durationMinutes: row.durationMinutes,
    price: row.price ?? null,
    color: row.color ?? null,
    isActive: row.isActive,
    employeeIds: row.employeeLinks.map((link) => link.employeeId),
  }));
}

async function loadClientsSummary(organizationId: string): Promise<CalendarBootstrapClientSummary[]> {
  const rows = await prisma.client.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "desc" },
    take: CALENDAR_BOOTSTRAP_CLIENTS_LIMIT,
    select: { id: true, name: true, phone: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone ?? null,
  }));
}

/** DB-only Google Calendar connection — never calls Google. */
async function loadConnectionStatus(organizationId: string): Promise<CalendarBootstrapConnectionStatus> {
  const integration = await prisma.integration.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "google_calendar" },
    },
    select: { refreshToken: true, metadata: true },
  });
  const connected = Boolean(integration?.refreshToken);
  return {
    connected,
    ...(connected
      ? { calendarId: calendarIdFromMetadata(integration?.metadata) ?? "primary" }
      : {}),
  };
}

/**
 * Query groups (bounded):
 * 1) organization (+ capabilities from same row)
 * 2) employees ∥ services ∥ clientsSummary ∥ connectionStatus
 */
export async function getCalendarBootstrap(
  organizationId: string,
  options?: GetCalendarBootstrapOptions
): Promise<CalendarBootstrapPayload> {
  const now = options?.now ?? new Date();
  const collect = Boolean(options?.collectTiming || options?.onTiming);
  const totalT0 = performance.now();

  const orgTimed = collect
    ? await timedMs(() => loadBootstrapOrganization(organizationId))
    : { value: await loadBootstrapOrganization(organizationId), ms: 0 };
  const org = orgTimed.value;
  const capabilities = capabilitiesFromFlags(org.flags);

  const metaT0 = performance.now();
  const [employees, services, clientsSummary, connectionStatus] = await Promise.all([
    loadEmployeesSlim(organizationId),
    loadServicesSlim(organizationId),
    loadClientsSummary(organizationId),
    loadConnectionStatus(organizationId),
  ]);
  const metaWaveMs = Math.round(performance.now() - metaT0);

  const serializeT0 = performance.now();
  const payload: CalendarBootstrapPayload = {
    capabilities,
    connectionStatus,
    settings: {
      timezone: org.timezone,
      workday: { weekStart: org.weekStart },
      locale: org.locale,
    },
    employees,
    services,
    clientsSummary,
    generatedAt: now.toISOString(),
  };
  const serializeMs = Math.round(performance.now() - serializeT0);

  if (collect) {
    const timing: CalendarBootstrapTiming = {
      organizationMs: orgTimed.ms,
      metaWaveMs,
      serializeMs,
      totalMs: Math.round(performance.now() - totalT0),
      organizationLookupCount: 1,
      queryGroupCount: 2,
    };
    options?.onTiming?.(timing);
    if (process.env.CALENDAR_BOOTSTRAP_TIMING === "1") {
      console.info("[calendar/bootstrap timing]", JSON.stringify(timing));
    }
  }

  return payload;
}

export function assertCalendarBootstrapPayloadBounds(payload: CalendarBootstrapPayload): void {
  if (payload.employees.length > CALENDAR_BOOTSTRAP_EMPLOYEES_LIMIT) {
    throw new Error(`employees length ${payload.employees.length} exceeds limit`);
  }
  if (payload.services.length > CALENDAR_BOOTSTRAP_SERVICES_LIMIT) {
    throw new Error(`services length ${payload.services.length} exceeds limit`);
  }
  if (payload.clientsSummary.length > CALENDAR_BOOTSTRAP_CLIENTS_LIMIT) {
    throw new Error(`clientsSummary length ${payload.clientsSummary.length} exceeds limit`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes >= CALENDAR_BOOTSTRAP_MAX_PAYLOAD_BYTES) {
    throw new Error(`calendar bootstrap payload ${bytes} bytes exceeds ${CALENDAR_BOOTSTRAP_MAX_PAYLOAD_BYTES}`);
  }
}
