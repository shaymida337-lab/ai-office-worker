/**
 * Natalie ↔ CRM bridge: open card, update profile fields, full appointment history.
 * Uses existing clientCard + schedulingCustomer services only (same org scoping as CRM routes).
 */

import type { NatalieClaudeResponse } from "../claude.js";
import {
  formatAmbiguousCustomerMessage,
  rankSchedulingCustomerMatches,
  searchSchedulingCustomers,
  type SchedulingCustomerCandidate,
} from "../scheduling/schedulingCustomer.js";
import {
  listClientAppointments,
  updateClientProfile,
  type ClientProfileUpdateInput,
} from "./clientCard.js";

export type NatalieCrmIntentKind =
  | "none"
  | "open_client"
  | "update_client"
  | "list_client_history";

export type NatalieCrmUpdateField = "phone" | "email" | "address";

export type NatalieCrmIntent = {
  kind: NatalieCrmIntentKind;
  clientName: string | null;
  field?: NatalieCrmUpdateField;
  value?: string;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.?!,:;\-–—]+$/u, "").trim();
}

/**
 * Deterministic Hebrew CRM intents — open / update / full history only.
 */
export function parseNatalieCrmIntent(rawQuestion: string): NatalieCrmIntent {
  const text = normalize(rawQuestion);
  if (!text) return { kind: "none", clientName: null };

  // תפתחי את הכרטיס של שרית / תפתח כרטיס של דנה
  const openMatch = text.match(
    /^(?:בבקשה\s+)?(?:ת)?פתח(?:י)?\s+(?:לי\s+)?(?:את\s+)?(?:ה)?כרטיס\s+(?:של\s+)?(.+)$/u
  );
  if (openMatch?.[1]) {
    const clientName = stripTrailingPunctuation(openMatch[1]);
    if (clientName.length >= 2) return { kind: "open_client", clientName };
  }

  // תראי לי את כל ההיסטוריה של שרית / הצגי את ההיסטוריה של שרית
  const historyMatch = text.match(
    /(?:תרא(?:י|ה)|הצ(?:יגי|ג)|הרא(?:י|ה))\s+(?:לי\s+)?(?:את\s+)?(?:כל\s+)?(?:ה)?היסטורי(?:ה|ית\s+הפגישות|ית\s+התורים)\s+של\s+(.+)$/u
  );
  if (historyMatch?.[1]) {
    const clientName = stripTrailingPunctuation(historyMatch[1]);
    if (clientName.length >= 2) return { kind: "list_client_history", clientName };
  }

  // תעדכני לשרית את הטלפון ל-050...
  const updatePhoneFor = text.match(
    /(?:ת)?עדכנ(?:י|ה)?\s+(?:ל)?(.+?)\s+את\s+(?:ה)?(?:טלפון|וואטסאפ|whatsapp)\s+ל[-–\s]*(.+)$/iu
  );
  if (updatePhoneFor?.[1] && updatePhoneFor[2]) {
    return {
      kind: "update_client",
      clientName: stripTrailingPunctuation(updatePhoneFor[1]),
      field: "phone",
      value: stripTrailingPunctuation(updatePhoneFor[2]),
    };
  }

  // תחליפי / תעדכני את המייל של שרית ל-...
  const updateEmail = text.match(
    /(?:תעדכנ(?:י|ה)?|תחליפי|תחלף|עדכנ(?:י|ה)?|החליפי|החלף)\s+(?:את\s+)?(?:ה)?(?:מייל|אימייל|דוא["״']?ל)\s+(?:של\s+)?(.+?)\s+ל[-–\s]*(.+)$/iu
  );
  if (updateEmail?.[1] && updateEmail[2]) {
    return {
      kind: "update_client",
      clientName: stripTrailingPunctuation(updateEmail[1]),
      field: "email",
      value: stripTrailingPunctuation(updateEmail[2]),
    };
  }

  // תעדכני לשרית את המייל ל-...
  const updateEmailFor = text.match(
    /(?:ת)?עדכנ(?:י|ה)?\s+(?:ל)?(.+?)\s+את\s+(?:ה)?(?:מייל|אימייל|דוא["״']?ל)\s+ל[-–\s]*(.+)$/iu
  );
  if (updateEmailFor?.[1] && updateEmailFor[2]) {
    return {
      kind: "update_client",
      clientName: stripTrailingPunctuation(updateEmailFor[1]),
      field: "email",
      value: stripTrailingPunctuation(updateEmailFor[2]),
    };
  }

  // תעדכני כתובת לשרית ל-... / תעדכני לשרית את הכתובת ל-...
  const updateAddress = text.match(
    /(?:ת)?עדכנ(?:י|ה)?\s+(?:את\s+)?(?:ה)?כתובת\s+(?:של\s+)?(.+?)\s+ל[-–\s]*(.+)$/iu
  );
  if (updateAddress?.[1] && updateAddress[2]) {
    return {
      kind: "update_client",
      clientName: stripTrailingPunctuation(updateAddress[1]),
      field: "address",
      value: stripTrailingPunctuation(updateAddress[2]),
    };
  }
  const updateAddressFor = text.match(
    /(?:ת)?עדכנ(?:י|ה)?\s+(?:ל)?(.+?)\s+את\s+(?:ה)?כתובת\s+ל[-–\s]*(.+)$/iu
  );
  if (updateAddressFor?.[1] && updateAddressFor[2]) {
    return {
      kind: "update_client",
      clientName: stripTrailingPunctuation(updateAddressFor[1]),
      field: "address",
      value: stripTrailingPunctuation(updateAddressFor[2]),
    };
  }

  return { kind: "none", clientName: null };
}

async function resolveUniqueClient(
  organizationId: string,
  spokenName: string
): Promise<
  | { kind: "resolved"; client: SchedulingCustomerCandidate }
  | { kind: "ambiguous"; answer: string }
  | { kind: "none"; answer: string }
> {
  const matches = await searchSchedulingCustomers({
    organizationId,
    query: spokenName,
  });
  if (matches.length === 0) {
    return { kind: "none", answer: formatAmbiguousCustomerMessage(spokenName, []) };
  }
  if (matches.length > 1) {
    const ranked = rankSchedulingCustomerMatches(spokenName, matches);
    return { kind: "ambiguous", answer: formatAmbiguousCustomerMessage(spokenName, ranked) };
  }
  return { kind: "resolved", client: matches[0]! };
}

function formatHistoryLine(item: {
  startTime: Date;
  serviceName: string | null;
  employeeName: string | null;
  status: string;
  price: number | null;
}): string {
  const when = new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(item.startTime);
  const parts = [when];
  if (item.serviceName?.trim()) parts.push(item.serviceName.trim());
  if (item.employeeName?.trim()) parts.push(item.employeeName.trim());
  if (item.status && item.status !== "confirmed") parts.push(`(${item.status})`);
  if (item.price != null) parts.push(`₪${item.price}`);
  return `• ${parts.join(" — ")}`;
}

function patchForField(field: NatalieCrmUpdateField, value: string): ClientProfileUpdateInput {
  if (field === "email") return { email: value };
  if (field === "address") return { address: value };
  // Match client edit form: primary contact phone lives on whatsappNumber; also set phone.
  return { phone: value, whatsappNumber: value };
}

function fieldLabelHe(field: NatalieCrmUpdateField): string {
  if (field === "email") return "המייל";
  if (field === "address") return "הכתובת";
  return "הטלפון";
}

export async function maybeBuildNatalieCrmResponse(
  organizationId: string,
  question: string
): Promise<NatalieClaudeResponse | null> {
  const intent = parseNatalieCrmIntent(question);
  if (intent.kind === "none" || !intent.clientName) return null;

  const resolution = await resolveUniqueClient(organizationId, intent.clientName);
  if (resolution.kind === "ambiguous" || resolution.kind === "none") {
    return { answer: resolution.answer };
  }

  const client = resolution.client;
  const path = `/dashboard/clients/${client.id}`;

  if (intent.kind === "open_client") {
    return {
      action: "open_client",
      proposal: {
        clientId: client.id,
        clientName: client.name,
        path,
      },
      answer: `פתחתי את הכרטיס של ${client.name}.\n${path}`,
    };
  }

  if (intent.kind === "list_client_history") {
    const appointments = await listClientAppointments({
      organizationId,
      clientId: client.id,
    });
    if (appointments.length === 0) {
      return { answer: `עדיין אין פגישות ללקוח ${client.name}.` };
    }
    const lines = appointments.map(formatHistoryLine);
    return {
      answer: `ההיסטוריה המלאה של ${client.name} (${appointments.length}):\n${lines.join("\n")}`,
    };
  }

  // update_client
  const field = intent.field;
  const value = intent.value?.trim() ?? "";
  if (!field || !value) {
    return { answer: `לא הבנתי מה לעדכן ל${client.name}.` };
  }

  return {
    action: "update_client",
    proposal: {
      clientId: client.id,
      clientName: client.name,
      field,
      value,
      path,
    },
    answer: `לעדכן ל${client.name} את ${fieldLabelHe(field)} ל-${value}?\nלאשר?`,
  };
}

export async function executeNatalieUpdateClient(params: {
  organizationId: string;
  proposal: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string }> {
  const clientId = typeof params.proposal.clientId === "string" ? params.proposal.clientId : "";
  const clientName = typeof params.proposal.clientName === "string" ? params.proposal.clientName : "הלקוח";
  const field = params.proposal.field;
  const value = typeof params.proposal.value === "string" ? params.proposal.value.trim() : "";
  if (!clientId || (field !== "phone" && field !== "email" && field !== "address") || !value) {
    return { ok: false, message: "חסרים פרטי עדכון ללקוח." };
  }

  const result = await updateClientProfile({
    organizationId: params.organizationId,
    clientId,
    patch: patchForField(field, value),
  });
  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  return {
    ok: true,
    message: `עדכנתי ל${clientName} את ${fieldLabelHe(field)} ל-${value}.`,
  };
}
