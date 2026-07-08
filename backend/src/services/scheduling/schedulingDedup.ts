/**
 * Read-side cross-table / Google-mirror appointment deduplication.
 * Does not delete or mutate stored rows — only collapses duplicates for display
 * and availability merges.
 */

export type DedupableSchedulingItem = {
  id: string;
  organizationId?: string;
  source: "appointment" | "calendar_event" | "google_calendar";
  clientId?: string | null;
  clientName: string;
  startTime: Date;
  durationMinutes: number;
  status?: string;
  googleEventId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Higher prefers richer/newer engine rows when keys collide. */
  richness?: number;
};

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeContact(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";
  // Digits-only for phones; emails keep @ form.
  if (raw.includes("@")) return raw;
  return raw.replace(/\D+/g, "");
}

/**
 * Stable identity for cross-source duplicates of the same booking.
 * Prefer googleEventId when present; otherwise org + name + start/end + contact.
 */
export function buildSchedulingDedupKey(
  item: DedupableSchedulingItem,
  organizationId?: string
): string {
  const googleId = item.googleEventId?.trim();
  if (googleId) {
    return `gcal:${googleId}`;
  }

  const org = organizationId ?? item.organizationId ?? "";
  const startMs = item.startTime.getTime();
  const endMs = startMs + Math.max(1, item.durationMinutes) * 60_000;
  const name = normalizeName(item.clientName);
  const phone = normalizeContact(item.phone);
  const email = normalizeContact(item.email);
  const clientPart = item.clientId?.trim() || name || "unknown";
  const contactPart = phone || email || "";

  return ["slot", org, clientPart, String(startMs), String(endMs), contactPart].join("|");
}

export function defaultSchedulingRichness(item: DedupableSchedulingItem): number {
  if (typeof item.richness === "number") return item.richness;
  // Prefer engine CalendarEvent over legacy Appointment over Google read-through.
  if (item.source === "calendar_event") return 30;
  if (item.source === "appointment") return 20;
  return 10;
}

/**
 * Keep one row per dedup key. On collision, keep the richer/newer source.
 * Order of remaining items follows first-seen order among winners (caller sorts).
 */
export function dedupeSchedulingItems<T extends DedupableSchedulingItem>(
  items: T[],
  organizationId?: string
): T[] {
  const winners = new Map<string, T>();
  const order: string[] = [];

  for (const item of items) {
    const key = buildSchedulingDedupKey(item, organizationId);
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, item);
      order.push(key);
      continue;
    }
    const existingScore = defaultSchedulingRichness(existing);
    const nextScore = defaultSchedulingRichness(item);
    if (nextScore > existingScore) {
      winners.set(key, item);
    }
  }

  return order.map((key) => winners.get(key)!).filter(Boolean);
}
