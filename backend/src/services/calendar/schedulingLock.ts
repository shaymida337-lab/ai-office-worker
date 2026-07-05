import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

/** Single org-level lock for all appointment + calendar-event scheduling writes. */
export const ORGANIZATION_SCHEDULING_LOCK_NAMESPACE = "calendar-scheduling";

const SCHEDULING_TX_MAX_WAIT_MS = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? 60_000);
const SCHEDULING_TX_TIMEOUT_MS = Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? 60_000);

export function organizationSchedulingLockKey(organizationId: string): string {
  return `${ORGANIZATION_SCHEDULING_LOCK_NAMESPACE}:${organizationId}`;
}

export async function withOrganizationSchedulingLock<T>(
  organizationId: string,
  action: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationSchedulingLockKey(organizationId)}))`;
      return action(tx);
    },
    {
      maxWait: SCHEDULING_TX_MAX_WAIT_MS,
      timeout: SCHEDULING_TX_TIMEOUT_MS,
    }
  );
}
