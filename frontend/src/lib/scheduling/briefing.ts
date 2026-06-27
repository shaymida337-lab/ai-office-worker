import { apiFetch } from "@/lib/api";

export type BriefingSchedulingSource = "appointment" | "calendar_event";

export type BriefingUpcomingItem = {
  id: string;
  source: BriefingSchedulingSource;
  clientName: string;
  serviceName?: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  status: string;
  statusLabel: string;
  pendingOwnerApproval: boolean;
};

export type BriefingPendingDecision = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  reason?: string | null;
  calendarEventId?: string | null;
  createdAt: string;
  href: string;
};

export type BriefingTodaySummary = {
  upcomingCount: number;
  pendingDecisionCount: number;
  todayCompletedCount: number;
  todayNoShowCount: number;
  todayCancelledCount: number;
};

export type BriefingSchedulingSnapshot = {
  engineReadEnabled: boolean;
  upcoming: BriefingUpcomingItem[];
  pendingDecisions: BriefingPendingDecision[];
  todaySummary: BriefingTodaySummary;
};

export async function fetchBriefingSchedulingSnapshot(from: string, to: string): Promise<BriefingSchedulingSnapshot> {
  return apiFetch<BriefingSchedulingSnapshot>(
    `/api/scheduling/briefing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
}

export function mapBriefingToAppointmentInputs(snapshot: BriefingSchedulingSnapshot) {
  return snapshot.upcoming.map((item) => ({
    id: item.id,
    clientName: item.clientName,
    startTime: item.startTime,
    status: item.status,
    source: item.source,
    statusLabel: item.statusLabel,
    pendingOwnerApproval: item.pendingOwnerApproval,
  }));
}

export function mapBriefingToDecisionAppointments(snapshot: BriefingSchedulingSnapshot) {
  return snapshot.upcoming.map((item) => ({
    id: item.id,
    clientName: item.clientName,
    startTime: item.startTime,
    status: item.status,
    source: item.source,
    pendingOwnerApproval: item.pendingOwnerApproval,
  }));
}
