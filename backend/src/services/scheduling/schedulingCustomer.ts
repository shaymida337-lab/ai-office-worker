import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  applyRealEmailToClientInTx,
  isPlaceholderClientEmail,
  isRealClientEmail,
  normalizeClientEmailInput,
} from "../clientContact.js";
import { normalizeWhatsAppNumber } from "../whatsapp.js";
import { SchedulingFacadeError } from "./schedulingErrors.js";
import { calendarMessages } from "../calendar/calendarMessages.js";
import {
  bestTierMatches,
  normalizeCustomerNameForMatch,
  rankCustomerMatches,
  resolveRankedCustomerMatches,
} from "./customerNameRanking.js";

export type SchedulingCustomerCandidate = {
  id: string;
  name: string;
  email: string | null;
  whatsappNumber: string | null;
  emailIsPlaceholder: boolean;
};

export type SchedulingCustomerInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  address?: string | null;
};

const CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  whatsappNumber: true,
  emailIsPlaceholder: true,
} as const;

export function normalizeSchedulingCustomerName(value: string): string {
  return normalizeCustomerNameForMatch(value);
}

export function normalizeSchedulingPhone(value: string): string {
  return value.replace(/\D/g, "");
}

function mergeAppointmentNotes(notes?: string | null, address?: string | null): string | null {
  const parts = [notes?.trim(), address?.trim() ? `כתובת: ${address.trim()}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

export function formatAmbiguousCustomerMessage(
  query: string,
  matches: SchedulingCustomerCandidate[]
): string {
  if (matches.length === 0) return calendarMessages.ambiguousCustomerNoMatch(query);
  const firstName = matches[0]?.name?.trim();
  const sameDisplayName =
    firstName &&
    matches.every(
      (match) => normalizeSchedulingCustomerName(match.name) === normalizeSchedulingCustomerName(firstName)
    );
  const list = matches.map((match, index) => `${index + 1}. ${match.name}`).join("\n");
  if (sameDisplayName) {
    return calendarMessages.ambiguousCustomerSameName(matches.length, firstName, list);
  }
  return calendarMessages.ambiguousCustomerDifferentNames(query, list);
}

function phoneMatchesQuery(stored: string | null | undefined, normalizedPhone: string): boolean {
  if (!stored || normalizedPhone.length < 9) return false;
  const storedDigits = normalizeSchedulingPhone(stored);
  return (
    storedDigits === normalizedPhone ||
    storedDigits.endsWith(normalizedPhone.slice(-9)) ||
    normalizedPhone.endsWith(storedDigits.slice(-9))
  );
}

async function loadClientById(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  clientId: string
): Promise<SchedulingCustomerCandidate | null> {
  return db.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
    select: CLIENT_SELECT,
  });
}

async function findClientsByPhone(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  phone: string
): Promise<SchedulingCustomerCandidate[]> {
  const normalizedPhone = normalizeSchedulingPhone(phone);
  if (normalizedPhone.length < 7) return [];

  const candidates = await db.client.findMany({
    where: {
      organizationId,
      isActive: true,
      whatsappNumber: { contains: normalizedPhone },
    },
    select: CLIENT_SELECT,
    take: 10,
    orderBy: { name: "asc" },
  });

  return candidates.filter((client) => phoneMatchesQuery(client.whatsappNumber, normalizedPhone));
}

async function findClientsByRealEmail(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  email: string
): Promise<SchedulingCustomerCandidate[]> {
  const normalizedEmail = normalizeClientEmailInput(email);
  if (!normalizedEmail) return [];

  return db.client.findMany({
    where: {
      organizationId,
      isActive: true,
      email: { equals: normalizedEmail, mode: "insensitive" },
      emailIsPlaceholder: false,
    },
    select: CLIENT_SELECT,
    take: 5,
    orderBy: { name: "asc" },
  });
}

async function findClientsByExactName(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  name: string
): Promise<SchedulingCustomerCandidate[]> {
  const normalizedName = normalizeSchedulingCustomerName(name);
  if (!normalizedName) return [];

  const candidates = await db.client.findMany({
    where: {
      organizationId,
      isActive: true,
      name: { equals: name.trim(), mode: "insensitive" },
    },
    select: CLIENT_SELECT,
    take: 10,
    orderBy: { name: "asc" },
  });

  return candidates.filter(
    (client) => normalizeSchedulingCustomerName(client.name) === normalizedName
  );
}

async function findClientsByFuzzyName(
  db: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  name: string
): Promise<SchedulingCustomerCandidate[]> {
  const query = name.trim();
  if (!query) return [];

  const candidates = await db.client.findMany({
    where: {
      organizationId,
      isActive: true,
      name: { contains: query, mode: "insensitive" },
    },
    select: CLIENT_SELECT,
    take: 20,
    orderBy: { name: "asc" },
  });

  return bestTierMatches(query, candidates);
}

export function rankSchedulingCustomerMatches(
  query: string,
  candidates: SchedulingCustomerCandidate[]
): ReturnType<typeof rankCustomerMatches<SchedulingCustomerCandidate>> {
  return rankCustomerMatches(query, candidates);
}

export function resolveSchedulingCustomerFromCandidates(
  query: string,
  candidates: Array<{ id: string; name: string }>
): ReturnType<typeof resolveRankedCustomerMatches<{ id: string; name: string }>> {
  return resolveRankedCustomerMatches(query, candidates);
}

export async function searchSchedulingCustomers(params: {
  organizationId: string;
  query: string;
  clientId?: string;
  tx?: Prisma.TransactionClient;
}): Promise<SchedulingCustomerCandidate[]> {
  const db = params.tx ?? prisma;

  if (params.clientId) {
    const explicit = await loadClientById(db, params.organizationId, params.clientId);
    return explicit ? [explicit] : [];
  }

  const query = params.query.trim();
  if (!query) return [];

  const normalizedPhone = normalizeSchedulingPhone(query);
  if (normalizedPhone.length >= 7) {
    const phoneMatches = await findClientsByPhone(db, params.organizationId, query);
    if (phoneMatches.length > 0) return phoneMatches;
  }

  if (query.includes("@")) {
    const emailMatches = await findClientsByRealEmail(db, params.organizationId, query);
    if (emailMatches.length > 0) return emailMatches;
    if (isPlaceholderClientEmail(query)) return [];
  }

  const exactNameMatches = await findClientsByExactName(db, params.organizationId, query);
  if (exactNameMatches.length > 0) return exactNameMatches;

  return findClientsByFuzzyName(db, params.organizationId, query);
}

export async function searchSchedulingCustomersByContact(params: {
  organizationId: string;
  phone?: string | null;
  email?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<SchedulingCustomerCandidate[]> {
  const db = params.tx ?? prisma;

  if (params.phone?.trim()) {
    const phoneMatches = await findClientsByPhone(db, params.organizationId, params.phone);
    if (phoneMatches.length > 0) return phoneMatches;
  }

  if (params.email?.trim()) {
    return findClientsByRealEmail(db, params.organizationId, params.email);
  }

  return [];
}

export async function resolveSchedulingCustomerMatches(params: {
  organizationId: string;
  name: string;
  clientId?: string;
  phone?: string | null;
  email?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<SchedulingCustomerCandidate[]> {
  const db = params.tx ?? prisma;
  const name = params.name.trim();

  if (params.clientId) {
    const explicit = await loadClientById(db, params.organizationId, params.clientId);
    return explicit ? [explicit] : [];
  }

  if (params.phone?.trim()) {
    const phoneMatches = await findClientsByPhone(db, params.organizationId, params.phone);
    if (phoneMatches.length > 0) return phoneMatches;
  }

  const realEmail = normalizeClientEmailInput(params.email);
  if (realEmail) {
    const emailMatches = await findClientsByRealEmail(db, params.organizationId, realEmail);
    if (emailMatches.length > 0) return emailMatches;
  }

  if (name) {
    const exactNameMatches = await findClientsByExactName(db, params.organizationId, name);
    if (exactNameMatches.length > 0) return exactNameMatches;
    return findClientsByFuzzyName(db, params.organizationId, name);
  }

  return [];
}

async function maybeUpgradeClientEmailInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    client: SchedulingCustomerCandidate;
    email?: string | null;
  }
): Promise<SchedulingCustomerCandidate> {
  const realEmail = normalizeClientEmailInput(params.email);
  if (!realEmail || isRealClientEmail(params.client.email, params.client.emailIsPlaceholder)) {
    return params.client;
  }

  await applyRealEmailToClientInTx(tx, {
    organizationId: params.organizationId,
    clientId: params.client.id,
    email: realEmail,
  });

  const refreshed = await loadClientById(tx, params.organizationId, params.client.id);
  return refreshed ?? { ...params.client, email: realEmail, emailIsPlaceholder: false };
}

export async function createSchedulingCustomerInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    customer: SchedulingCustomerInput;
  }
): Promise<SchedulingCustomerCandidate> {
  const name = params.customer.name.trim();
  if (!name) {
    throw new Error("Customer name is required");
  }

  const email = normalizeClientEmailInput(params.customer.email);
  const whatsappNumber = params.customer.phone?.trim()
    ? normalizeWhatsAppNumber(params.customer.phone)
    : null;

  const count = await tx.client.count({ where: { organizationId: params.organizationId } });
  const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

  return tx.client.create({
    data: {
      organizationId: params.organizationId,
      name,
      email,
      emailIsPlaceholder: false,
      whatsappNumber,
      color: colors[count % colors.length],
      firstSeen: new Date(),
      lastSeen: new Date(),
    },
    select: CLIENT_SELECT,
  });
}

export async function resolveOrCreateSchedulingCustomerInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    name: string;
    clientId?: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    address?: string | null;
  }
): Promise<{ client: SchedulingCustomerCandidate; created: boolean; appointmentNotes: string | null }> {
  const matches = await resolveSchedulingCustomerMatches({
    organizationId: params.organizationId,
    name: params.name,
    clientId: params.clientId,
    phone: params.phone,
    email: params.email,
    tx,
  });

  if (matches.length > 1) {
    throw new SchedulingFacadeError("multiple_clients", formatAmbiguousCustomerMessage(params.name, matches), {
      clients: matches,
    });
  }

  if (matches.length === 1) {
    const client = await maybeUpgradeClientEmailInTx(tx, {
      organizationId: params.organizationId,
      client: matches[0]!,
      email: params.email,
    });
    return {
      client,
      created: false,
      appointmentNotes: mergeAppointmentNotes(params.notes, params.address),
    };
  }

  const client = await createSchedulingCustomerInTx(tx, {
    organizationId: params.organizationId,
    customer: {
      name: params.name,
      phone: params.phone,
      email: params.email,
      notes: params.notes,
      address: params.address,
    },
  });

  return {
    client,
    created: true,
    appointmentNotes: mergeAppointmentNotes(params.notes, params.address),
  };
}
