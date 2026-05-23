import { createHash } from "crypto";

/** Prevent duplicate invoice rows from same supplier + amount + date + subject fingerprint */
export function buildDuplicateHash(input: {
  organizationId: string;
  supplier: string;
  amount: number;
  dateIso: string;
  subject?: string | null;
}): string {
  const normalized = [
    input.organizationId,
    input.supplier.trim().toLowerCase(),
    input.amount.toFixed(2),
    input.dateIso.slice(0, 10),
    (input.subject ?? "").trim().toLowerCase().slice(0, 80),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}
