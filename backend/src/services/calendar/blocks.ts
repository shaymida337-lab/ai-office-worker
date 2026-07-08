import { prisma } from "../../lib/prisma.js";
import { appointmentEnd } from "./engine.js";
import type { BusyBlock, TimeInterval } from "./types.js";

export async function loadAppointmentBusyBlocks(
  organizationId: string,
  range: TimeInterval,
  options?: { excludeAppointmentId?: string }
): Promise<BusyBlock[]> {
  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: { not: "cancelled" },
      startTime: { lt: range.end },
      ...(options?.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
    },
    select: {
      id: true,
      startTime: true,
      durationMinutes: true,
      googleEventId: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const blocks: BusyBlock[] = [];

  for (const appointment of appointments) {
    const start = appointment.startTime;
    const end = appointmentEnd(start, appointment.durationMinutes);
    if (end.getTime() <= range.start.getTime()) continue;
    if (start.getTime() >= range.end.getTime()) continue;

    blocks.push({
      id: appointment.id,
      source: "appointment",
      start,
      end,
      clientName: appointment.client.name,
      serviceName: appointment.service?.name ?? undefined,
      durationMinutes: appointment.durationMinutes,
      googleEventId: appointment.googleEventId,
    });
  }

  return blocks;
}
