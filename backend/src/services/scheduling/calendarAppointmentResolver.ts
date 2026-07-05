import type { UpcomingSchedulingItem } from "./schedulingFacade.js";
import { searchSchedulingCustomers } from "./schedulingCustomer.js";

export type AppointmentResolutionSource = "exact" | "fuzzy" | "conversation_context" | "failed";

export type ActiveCalendarContext = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  when?: string;
};

export type UpcomingSchedulingItemWithClient = UpcomingSchedulingItem & {
  clientId: string;
};

export type AppointmentNameResolution = {
  clientId: string;
  clientName: string;
  spokenName: string;
  matchedName: string;
  matchScore: number;
  resolutionSource: AppointmentResolutionSource;
  needsConfirmation: boolean;
};

const AUTO_RESOLVE_THRESHOLD = 0.85;
const CONFIRM_THRESHOLD = 0.65;

const HEBREW_STT_EQUIVALENTS: Record<string, string> = {
  ג: "י",
  י: "ג",
  ו: "ב",
  ב: "ו",
  ט: "ת",
  ת: "ט",
  כ: "ק",
  ק: "כ",
  ס: "ש",
  ש: "ס",
};

export function normalizeHebrewAppointmentText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function applySttEquivalentVariants(token: string): string[] {
  const variants = new Set<string>([token]);
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]!;
    const alt = HEBREW_STT_EQUIVALENTS[ch];
    if (!alt) continue;
    variants.add(token.slice(0, i) + alt + token.slice(i + 1));
  }
  return [...variants];
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const direct = similarityScore(a, b);
  let best = direct;
  for (const variant of applySttEquivalentVariants(a)) {
    best = Math.max(best, similarityScore(variant, b));
  }
  for (const variant of applySttEquivalentVariants(b)) {
    best = Math.max(best, similarityScore(a, variant));
  }
  return best;
}

export function computeAppointmentNameSimilarity(spokenName: string, candidateName: string): number {
  const spoken = normalizeHebrewAppointmentText(spokenName);
  const candidate = normalizeHebrewAppointmentText(candidateName);
  if (!spoken || !candidate) return 0;
  if (spoken === candidate) return 1;

  const spokenTokens = spoken.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (spokenTokens.length === 0 || candidateTokens.length === 0) {
    return similarityScore(spoken, candidate);
  }

  const lastSpoken = spokenTokens[spokenTokens.length - 1]!;
  const lastCandidate = candidateTokens[candidateTokens.length - 1]!;
  const lastNameMatch = lastSpoken === lastCandidate ? 1 : tokenSimilarity(lastSpoken, lastCandidate);

  const firstSpoken = spokenTokens[0]!;
  const firstCandidate = candidateTokens[0]!;
  const firstNameSim = firstSpoken === firstCandidate ? 1 : tokenSimilarity(firstSpoken, firstCandidate);

  const fullSim = similarityScore(spoken, candidate);
  if (spokenTokens.length === 1 || candidateTokens.length === 1) {
    return Math.max(fullSim, firstNameSim * 0.9);
  }

  return Math.max(fullSim, lastNameMatch * 0.7 + firstNameSim * 0.3);
}

export function findBestAppointmentNameMatch(
  spokenName: string,
  appointments: UpcomingSchedulingItemWithClient[]
): { appointment: UpcomingSchedulingItemWithClient; matchScore: number } | null {
  const ranked = rankAppointmentNameMatches(spokenName, appointments);
  return ranked[0] ?? null;
}

export function rankAppointmentNameMatches(
  spokenName: string,
  appointments: UpcomingSchedulingItemWithClient[]
): Array<{ appointment: UpcomingSchedulingItemWithClient; matchScore: number }> {
  const normalizedSpoken = normalizeHebrewAppointmentText(spokenName);
  if (!normalizedSpoken) return [];

  const ranked: Array<{ appointment: UpcomingSchedulingItemWithClient; matchScore: number }> = [];
  const seenClients = new Set<string>();

  for (const appointment of appointments) {
    if (seenClients.has(appointment.clientId)) continue;
    seenClients.add(appointment.clientId);
    ranked.push({
      appointment,
      matchScore: computeAppointmentNameSimilarity(spokenName, appointment.clientName),
    });
  }

  return ranked.sort((a, b) => b.matchScore - a.matchScore);
}

export function findAmbiguousAppointmentNameMatches(
  spokenName: string,
  appointments: UpcomingSchedulingItemWithClient[]
): {
  kind: "resolved";
  match: { appointment: UpcomingSchedulingItemWithClient; matchScore: number };
} | {
  kind: "ambiguous";
  candidates: Array<{ appointment: UpcomingSchedulingItemWithClient; matchScore: number }>;
} | {
  kind: "none";
} {
  const ranked = rankAppointmentNameMatches(spokenName, appointments).filter(
    (item) => item.matchScore >= CONFIRM_THRESHOLD
  );
  if (ranked.length === 0) return { kind: "none" };

  const top = ranked[0]!;
  const closeMatches = ranked.filter(
    (item) =>
      item.appointment.clientId !== top.appointment.clientId &&
      top.matchScore - item.matchScore <= 0.05
  );
  if (closeMatches.length > 0) {
    return { kind: "ambiguous", candidates: [top, ...closeMatches] };
  }

  return { kind: "resolved", match: top };
}

export function logAppointmentResolution(input: {
  originalTranscript: string;
  normalizedTranscript: string;
  matchedAppointmentName: string | null;
  matchScore: number | null;
  resolutionSource: AppointmentResolutionSource;
}): void {
  console.info("[natalie/calendar-resolution]", {
    originalTranscript: input.originalTranscript,
    normalizedTranscript: input.normalizedTranscript,
    matchedAppointmentName: input.matchedAppointmentName,
    matchScore: input.matchScore,
    resolutionSource: input.resolutionSource,
  });
}

export function extractActiveCalendarContext(input: {
  history?: Array<{ role: "user" | "assistant"; content: string; action?: string | null; proposal?: Record<string, unknown> | null }>;
  pendingAction?: { action: string; proposal: Record<string, unknown> } | null;
}): ActiveCalendarContext | null {
  const fromProposal = (action: string, proposal: Record<string, unknown>): ActiveCalendarContext | null => {
    if (!["reschedule_appointment", "cancel_appointment", "book_appointment"].includes(action)) {
      return null;
    }
    const appointmentId = typeof proposal.appointmentId === "string" ? proposal.appointmentId : null;
    const clientName = typeof proposal.clientName === "string" ? proposal.clientName.trim() : "";
    const clientId = typeof proposal.clientId === "string" ? proposal.clientId : "";
    if (!clientName) return null;
    if (appointmentId) {
      return {
        appointmentId,
        clientId,
        clientName,
        when: typeof proposal.when === "string" ? proposal.when : typeof proposal.newWhen === "string" ? proposal.newWhen : undefined,
      };
    }
    return clientId ? { appointmentId: "", clientId, clientName, when: undefined } : null;
  };

  if (input.pendingAction) {
    const context = fromProposal(input.pendingAction.action, input.pendingAction.proposal);
    if (context) return context;
  }

  const history = input.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    if (turn.proposal && turn.action) {
      const context = fromProposal(turn.action, turn.proposal);
      if (context) return context;
    }

    if (turn.role !== "assistant") continue;
    const mention = turn.content.match(/(?:תור\s+(?:של|ל)|ל)([^\n,.?!]{2,40})/u);
    const clientName = mention?.[1]?.trim();
    if (clientName && clientName.length >= 3) {
      return { appointmentId: "", clientId: "", clientName };
    }
  }

  return null;
}

export function isPronounCalendarReference(text: string): boolean {
  const normalized = normalizeHebrewAppointmentText(text);
  return /(?:^|\s)(?:אותו|אותה|לו|לה)(?:\s|$)/u.test(normalized);
}

export async function resolveAppointmentCustomerName(input: {
  organizationId: string;
  spokenName: string | null;
  originalTranscript: string;
  upcomingAppointments: UpcomingSchedulingItemWithClient[];
  activeContext?: ActiveCalendarContext | null;
}): Promise<AppointmentNameResolution | null> {
  const originalTranscript = input.originalTranscript.trim();
  const normalizedTranscript = normalizeHebrewAppointmentText(originalTranscript);
  const spokenName = input.spokenName?.trim() ?? "";

  if (!spokenName && input.activeContext?.clientName) {
    const matchedAppointment = input.upcomingAppointments.find(
      (item) =>
        item.id === input.activeContext?.appointmentId ||
        normalizeHebrewAppointmentText(item.clientName) ===
          normalizeHebrewAppointmentText(input.activeContext!.clientName)
    );
    if (!matchedAppointment) {
      logAppointmentResolution({
        originalTranscript,
        normalizedTranscript,
        matchedAppointmentName: input.activeContext.clientName,
        matchScore: null,
        resolutionSource: "failed",
      });
      return null;
    }
    const clientId = input.activeContext.clientId || matchedAppointment.clientId;
    logAppointmentResolution({
      originalTranscript,
      normalizedTranscript,
      matchedAppointmentName: input.activeContext.clientName,
      matchScore: 1,
      resolutionSource: "conversation_context",
    });
    return {
      clientId,
      clientName: input.activeContext.clientName,
      spokenName: input.activeContext.clientName,
      matchedName: input.activeContext.clientName,
      matchScore: 1,
      resolutionSource: "conversation_context",
      needsConfirmation: false,
    };
  }

  if (!spokenName) {
    logAppointmentResolution({
      originalTranscript,
      normalizedTranscript,
      matchedAppointmentName: null,
      matchScore: null,
      resolutionSource: "failed",
    });
    return null;
  }

  const exactCustomers = await searchSchedulingCustomers({
    organizationId: input.organizationId,
    query: spokenName,
  });
  if (exactCustomers.length === 1) {
    const client = exactCustomers[0]!;
    logAppointmentResolution({
      originalTranscript,
      normalizedTranscript,
      matchedAppointmentName: client.name,
      matchScore: 1,
      resolutionSource: "exact",
    });
    return {
      clientId: client.id,
      clientName: client.name,
      spokenName,
      matchedName: client.name,
      matchScore: 1,
      resolutionSource: "exact",
      needsConfirmation: false,
    };
  }
  if (exactCustomers.length > 1) {
    return null;
  }

  const fuzzyResolution = findAmbiguousAppointmentNameMatches(spokenName, input.upcomingAppointments);
  if (fuzzyResolution.kind === "none") {
    logAppointmentResolution({
      originalTranscript,
      normalizedTranscript,
      matchedAppointmentName: null,
      matchScore: null,
      resolutionSource: "failed",
    });
    return null;
  }
  if (fuzzyResolution.kind === "ambiguous") {
    return null;
  }

  const { appointment, matchScore } = fuzzyResolution.match;
  const resolutionSource: AppointmentResolutionSource = matchScore >= AUTO_RESOLVE_THRESHOLD ? "fuzzy" : "fuzzy";
  logAppointmentResolution({
    originalTranscript,
    normalizedTranscript,
    matchedAppointmentName: appointment.clientName,
    matchScore,
    resolutionSource,
  });

  return {
    clientId: appointment.clientId,
    clientName: appointment.clientName,
    spokenName,
    matchedName: appointment.clientName,
    matchScore,
    resolutionSource,
    needsConfirmation: matchScore < AUTO_RESOLVE_THRESHOLD,
  };
}
