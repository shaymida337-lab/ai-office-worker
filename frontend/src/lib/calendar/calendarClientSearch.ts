import { apiFetch } from "@/lib/api";

export type CalendarClientSearchHit = {
  id: string;
  name: string;
  phone?: string | null;
};

export function buildCalendarClientSearchPath(input: { query?: string; clientId?: string }): string | null {
  const params = new URLSearchParams();
  if (input.clientId?.trim()) params.set("id", input.clientId.trim());
  else if (input.query?.trim()) params.set("q", input.query.trim());
  else return null;
  return `/api/calendar/clients/search?${params.toString()}`;
}

export async function searchCalendarClientsOnDemand(input: {
  query?: string;
  clientId?: string;
  signal?: AbortSignal;
}): Promise<CalendarClientSearchHit[]> {
  const path = buildCalendarClientSearchPath(input);
  if (!path) return [];

  const data = await apiFetch<{ clients: CalendarClientSearchHit[] }>(path, { signal: input.signal });
  return Array.isArray(data.clients) ? data.clients : [];
}

/** Merge search hits into the form client list without unbounded growth. */
export function mergeCalendarClientOptions<T extends { id: string }>(
  existing: T[],
  hits: T[],
  max = 220
): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) byId.set(row.id, row);
  for (const hit of hits) byId.set(hit.id, hit);
  return Array.from(byId.values()).slice(0, max);
}

/** Pure selection helper used by form + tests (201+ clients). */
export function selectCalendarClientFromHits<T extends { id: string; name: string }>(
  hits: T[],
  clientId: string
): T | null {
  return hits.find((hit) => hit.id === clientId) ?? null;
}
