/**
 * חיפוש במסך רשימת הלקוחות (/dashboard/clients): כשיש שאילתה מחפשים
 * במקביל גם בלקוחות וגם בלידים — אותם מקורות שהחיפוש העליון סורק, עם
 * אותה לוגיקת סינון משותפת (clientSearch). כששדה החיפוש ריק הרשימה
 * מציגה לקוחות בלבד, בדיוק כמו קודם.
 */

import { clientMatchesQuery, filterClientsByQuery, type SearchableClient } from "./clientSearch";

/** ליד כפי שחוזר מ-GET /api/leads — רק השדות שהחיפוש והתצוגה צריכים. */
export type SearchableLead = {
  id: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
};

function leadToSearchable(lead: SearchableLead): SearchableClient {
  return {
    // שם החברה נכלל בטקסט החיפוש, כמו בחיפוש הלידים של מסך ה-CRM
    name: `${lead.name} ${lead.company ?? ""}`,
    email: lead.email,
    phone: lead.phone,
    whatsappNumber: lead.whatsapp,
  };
}

export function buildClientsListSearch<TClient extends SearchableClient, TLead extends SearchableLead>({
  clients,
  leads,
  query,
}: {
  clients: TClient[];
  leads: TLead[];
  query: string;
}): { clients: TClient[]; leads: TLead[] } {
  const trimmed = query.trim();
  if (!trimmed) {
    return { clients, leads: [] };
  }
  return {
    clients: filterClientsByQuery(clients, trimmed),
    leads: leads.filter((lead) => clientMatchesQuery(leadToSearchable(lead), trimmed)),
  };
}
