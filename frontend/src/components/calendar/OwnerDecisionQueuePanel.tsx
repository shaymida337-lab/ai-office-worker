"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button, MessageBanner, Skeleton, StatusBadge } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
import {
  approveOwnerDecision,
  CalendarEngineUnavailableError,
  fetchPendingOwnerDecisions,
  rejectOwnerDecision,
} from "@/lib/calendarEngine/api";
import type { OwnerDecisionQueueItem } from "@/lib/calendarEngine/types";
import { CALENDAR_ENGINE_DISABLED_MESSAGE } from "@/lib/calendarEngine/statusLabels";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { calendarUi } from "./calendarUi";

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
    <div className={calendarUi.queuePanel} dir="rtl" data-testid="owner-decision-queue">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className={`text-lg font-black ${natalie.title}`}>תור החלטות</h2>
          {!loading && pendingCount > 0 && (
            <StatusBadge tone="warn">{pendingCount} ממתינות</StatusBadge>
          )}
        </div>
      </div>

      {disabledMessage ? (
        <p className={`mb-2 text-sm font-semibold ${natalie.subtitle}`}>{disabledMessage}</p>
      ) : null}

      {error ? (
        <MessageBanner tone="error" className="mb-2">
          {error}
        </MessageBanner>
      ) : null}

      {loading ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : items.length === 0 ? (
        <p className={`text-sm font-semibold ${natalie.subtitle}`}>אין החלטות ממתינות</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const eventId = item.calendarEventId ?? item.calendarEvent?.id;
            return (
              <li
                key={item.id}
                ref={focusedDecisionId === item.id ? highlightRef : undefined}
                className={calendarUi.queueItem(focusedDecisionId === item.id)}
                data-testid={`decision-card-${item.type}`}
                data-decision-id={item.id}
              >
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className={`font-black ${natalie.title}`}>{item.title}</p>
                    <p className={`text-xs font-semibold ${natalie.subtitle}`}>
                      {decisionTypeLabel(item.type)} · {formatDecisionTime(item.createdAt, orgTimezone)}
                    </p>
                    {item.reason && (
                      <p className={`mt-1 text-sm font-semibold ${natalie.title}`}>{item.reason}</p>
                    )}
                    {formatPreparedPayload(item, orgTimezone) && (
                      <p className={`mt-1 text-sm font-semibold ${natalie.accent}`} data-testid="decision-prepared-payload">
                        {formatPreparedPayload(item, orgTimezone)}
                      </p>
                    )}
                  </div>
                  <StatusBadge tone="warn">ממתין לאישורך</StatusBadge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={actingId === item.id}
                    onClick={() => handleApprove(item.id)}
                    data-testid="decision-approve"
                  >
                    <Check className="h-4 w-4" />
                    {actingId === item.id ? "מאשר..." : "אשר"}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    type="button"
                    disabled={actingId === item.id}
                    onClick={() => handleReject(item.id)}
                    data-testid="decision-reject"
                  >
                    <X className="h-4 w-4" />
                    דחה
                  </Button>
                  {eventId && onSelectEvent && (
                    <Button variant="secondary" size="sm" type="button" onClick={() => onSelectEvent(eventId)}>
                      פרטי אירוע
                    </Button>
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
