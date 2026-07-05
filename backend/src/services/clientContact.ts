import type { Prisma } from "@prisma/client";

export const PLACEHOLDER_EMAIL_DOMAIN = "@scheduling.local";
export const WHATSAPP_SYNTHETIC_EMAIL_DOMAIN = "@whatsapp.local";

const SYNTHETIC_EMAIL_SUFFIXES = [PLACEHOLDER_EMAIL_DOMAIN, WHATSAPP_SYNTHETIC_EMAIL_DOMAIN] as const;

export type ClientEmailFields = {
  email?: string | null;
  emailIsPlaceholder?: boolean;
};

export function isPlaceholderClientEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  const normalized = email.trim().toLowerCase();
  return SYNTHETIC_EMAIL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function isRealClientEmail(
  email: string | null | undefined,
  emailIsPlaceholder: boolean | null | undefined = false
): boolean {
  if (emailIsPlaceholder) return false;
  if (!email?.trim()) return false;
  return !isPlaceholderClientEmail(email);
}

export function getClientDeliverableEmail(client: ClientEmailFields): string | null {
  if (!isRealClientEmail(client.email, client.emailIsPlaceholder)) return null;
  return client.email!.trim().toLowerCase();
}

export function normalizeClientEmailInput(email?: string | null): string | null {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return null;
  if (isPlaceholderClientEmail(trimmed)) return null;
  return trimmed;
}

export function clientEmailForOutbound<T extends ClientEmailFields>(
  client: T
): Omit<T, "email" | "emailIsPlaceholder"> & { email: string | null } {
  return {
    ...client,
    email: getClientDeliverableEmail(client),
  };
}

export async function findClientByRealEmail(
  db: Prisma.TransactionClient | { client: Prisma.ClientDelegate },
  params: {
    organizationId: string;
    email: string;
    excludeClientId?: string;
  }
) {
  const email = normalizeClientEmailInput(params.email);
  if (!email) return null;

  return db.client.findFirst({
    where: {
      organizationId: params.organizationId,
      isActive: true,
      email: { equals: email, mode: "insensitive" },
      emailIsPlaceholder: false,
      ...(params.excludeClientId ? { id: { not: params.excludeClientId } } : {}),
    },
    select: { id: true, name: true, email: true, whatsappNumber: true, emailIsPlaceholder: true },
  });
}

export async function applyRealEmailToClientInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    clientId: string;
    email?: string | null;
  }
): Promise<{ updated: boolean; email: string | null }> {
  const realEmail = normalizeClientEmailInput(params.email);
  if (!realEmail) return { updated: false, email: null };

  const current = await tx.client.findFirst({
    where: { id: params.clientId, organizationId: params.organizationId, isActive: true },
    select: { id: true, email: true, emailIsPlaceholder: true },
  });
  if (!current) return { updated: false, email: null };

  if (isRealClientEmail(current.email, current.emailIsPlaceholder)) {
    const currentNormalized = current.email!.trim().toLowerCase();
    if (currentNormalized === realEmail) return { updated: false, email: realEmail };
    return { updated: false, email: currentNormalized };
  }

  const duplicate = await findClientByRealEmail(tx, {
    organizationId: params.organizationId,
    email: realEmail,
    excludeClientId: params.clientId,
  });
  if (duplicate) {
    throw new Error(`Another customer already uses email ${realEmail}`);
  }

  await tx.client.update({
    where: { id: params.clientId },
    data: { email: realEmail, emailIsPlaceholder: false },
  });

  return { updated: true, email: realEmail };
}
