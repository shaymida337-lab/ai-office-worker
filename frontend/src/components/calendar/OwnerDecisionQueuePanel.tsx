"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  approveOwnerDecision,
  CalendarEngineUnavailableError,
  fetchPendingOwnerDecisions,
  rejectOwnerDecision,
} from "@/lib/calendarEngine/api";
import type { OwnerDecisionQueueItem } from "@/lib/calendarEngine/types";
import { CALENDAR_ENGINE_DISABLED_MESSAGE } from "@/lib/calendarEngine/statusLabels";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";

const btnPrimarySm =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:opacity-60";
const btnDangerSm =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[#B91C1C] bg-[#FEE2E2] px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#FECACA] disabled:cursor-not-allowed disabled:opacity-60";

const DECISION_TYPE_LABELS: Record<string, string> = {
  confirm_appointment: "אישור פגישה",
  override_conflict: "עקיפת חפיפה",
  cancel_appointment: "ביטול תור",
  reschedule_appointment: "דחיית תור",
};

function formatPreparedPayload(item: OwnerDecisionQueueItem, timeZone: string): string | null {
  const payload = item.preparedPayloadJson;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.startAt === "string" && typeof record.endAt === "string") {
    const start = new Date(record.startAt);
    const end = new Date(record.endAt);
    const date = start.toLocaleDateString("he-IL", { day: "numeric", month: "short", timeZone });
    const fromTime = start.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    const toTime = end.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
    return `מועד מוצע: ${date} · ${fromTime}–${toTime}`;
  }
  if (record.targetStatus === "cancelled") {
    return "פעולה: ביטול התור לאחר אישור";
  }
  return null;
}

function decisionTypeLabel(type: string): string {
  return DECISION_TYPE_LABELS[type] ?? "החלטה";
}

function formatDecisionTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

type OwnerDecisionQueuePanelProps = {
  refreshKey?: number;
  highlightDecisionId?: string | null;
  onDecisionResolved?: () => void;
  onSelectEvent?: (eventId: string) => void;
};

export function OwnerDecisionQueuePanel({
  refreshKey = 0,
  highlightDecisionId = null,
  onDecisionResolved,
  onSelectEvent,
}: OwnerDecisionQueuePanelProps) {
  const orgTimezone = useOrganizationTimezone();
  const [items, setItems] = useState<OwnerDecisionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabledMessage, setDisabledMessage] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedDecisionId, setFocusedDecisionId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingOwnerDecisions();
      setItems(data);
      setDisabledMessage(null);
    } catch (err) {
      if (err instanceof CalendarEngineUnavailableError) {
        setDisabledMessage(CALENDAR_ENGINE_DISABLED_MESSAGE);
        setItems([]);
        return;
      }
      setError(err instanceof Error ? err.message : "טעינת תור ההחלטות נכשלה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!highlightDecisionId || loading) return;
    const exists = items.some((item) => item.id === highlightDecisionId);
    if (!exists) return;
    setFocusedDecisionId(highlightDecisionId);
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightDecisionId, items, loading]);

  async function handleApprove(id: string) {
    setActingId(id);
    setError(null);
    try {
      await approveOwnerDecision(id);
      await load();
      onDecisionResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "אישור ההחלטה נכשל");
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id: string) {
    setActingId(id);
    setError(null);
    try {
      await rejectOwnerDecision(id);
      await load();
      onDecisionResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "דחיית ההחלטה נכשלה");
    } finally {
      setActingId(null);
    }
  }

  const pendingCount = items.length;

  return (
    <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[#111827] shadow-sm" dir="rtl" data-testid="owner-decision-queue">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black">תור החלטות</h2>
          {!loading && pendingCount > 0 && (
            <StatusPill tone="warn">{pendingCount} ממתינות</StatusPill>
          )}
        </div>
      </div>

      {disabledMessage && (
        <p className="mb-2 text-sm font-semibold text-[#6B7280]">{disabledMessage}</p>
      )}

      {error && (
        <p className="mb-2 text-sm font-semibold text-[#B91C1C]">{error}</p>
      )}

      {loading ? (
        <div className="skeleton h-16 rounded-xl" />
      ) : items.length === 0 ? (
        <p className="text-sm font-semibold text-[#6B7280]">אין החלטות ממתינות</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const eventId = item.calendarEventId ?? item.calendarEvent?.id;
            return (
              <li
                key={item.id}
                ref={focusedDecisionId === item.id ? highlightRef : undefined}
                className={`rounded-xl border bg-[#F8FAFC] p-3 ${
                  focusedDecisionId === item.id
                    ? "border-[#1D4ED8] ring-2 ring-[#BFDBFE]"
                    : "border-[#E5E7EB]"
                }`}
                data-testid={`decision-card-${item.type}`}
                data-decision-id={item.id}
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-black">{item.title}</p>
                    <p className="text-xs font-semibold text-[#6B7280]">
                      {decisionTypeLabel(item.type)} · {formatDecisionTime(item.createdAt, orgTimezone)}
                    </p>
                    {item.reason && (
                      <p className="mt-1 text-sm font-semibold text-[#374151]">{item.reason}</p>
                    )}
                    {formatPreparedPayload(item, orgTimezone) && (
                      <p className="mt-1 text-sm font-semibold text-[#1D4ED8]" data-testid="decision-prepared-payload">
                        {formatPreparedPayload(item, orgTimezone)}
                      </p>
                    )}
                  </div>
                  <StatusPill tone="warn">ממתין לאישורך</StatusPill>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={btnPrimarySm}
                    disabled={actingId === item.id}
                    onClick={() => handleApprove(item.id)}
                    data-testid="decision-approve"
                  >
                    <Check className="h-4 w-4" />
                    {actingId === item.id ? "מאשר..." : "אשר"}
                  </button>
                  <button
                    type="button"
                    className={btnDangerSm}
                    disabled={actingId === item.id}
                    onClick={() => handleReject(item.id)}
                    data-testid="decision-reject"
                  >
                    <X className="h-4 w-4" />
                    דחה
                  </button>
                  {eventId && onSelectEvent && (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6]"
                      onClick={() => onSelectEvent(eventId)}
                    >
                      פרטי אירוע
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
