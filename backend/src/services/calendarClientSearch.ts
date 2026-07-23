/**
 * On-demand calendar client lookup — bounded search, never a full clients list.
 */
import {
  searchSchedulingCustomers,
  type SchedulingCustomerCandidate,
} from "./scheduling/schedulingCustomer.js";

export const CALENDAR_CLIENT_SEARCH_LIMIT = 20;

export type CalendarClientSearchHit = {
  id: string;
  name: string;
  phone: string | null;
};

function toHit(row: SchedulingCustomerCandidate): CalendarClientSearchHit {
  return {
    id: row.id,
    name: row.name,
    phone: row.whatsappNumber ?? null,
  };
}

export async function searchCalendarClients(params: {
  organizationId: string;
  query?: string;
  clientId?: string;
}): Promise<CalendarClientSearchHit[]> {
  const clientId = params.clientId?.trim();
  if (clientId) {
    const matches = await searchSchedulingCustomers({
      organizationId: params.organizationId,
      query: "",
      clientId,
    });
    return matches.slice(0, 1).map(toHit);
  }

  const query = params.query?.trim() ?? "";
  if (query.length < 2) return [];

  const matches = await searchSchedulingCustomers({
    organizationId: params.organizationId,
    query,
  });
  return matches.slice(0, CALENDAR_CLIENT_SEARCH_LIMIT).map(toHit);
}
