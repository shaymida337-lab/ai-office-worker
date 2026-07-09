"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarClock, CheckCircle2, Clock, Mail, MessageCircle, Phone, UserCircle2, X } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { apiFetch } from "@/lib/api";
import {
  completeCalendarEvent,
  fetchCalendarEventById,
  fetchPendingOwnerDecisions,
  fetchWorkCaseTimeline,
  markCalendarEventNoShow,
  requestCalendarEventCancel,
  requestCalendarEventReschedule,
  requestDecisionUserMessage,
} from "@/lib/calendarEngine/api";
import { buildEndAtIso } from "@/lib/calendarEngine/adapters";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import { dateInputValueInTimeZone, timeInputValueInTimeZone } from "@/lib/orgTimezone";
import type { CalendarEngineEvent, CalendarPrerequisite, OwnerDecisionQueueItem, WorkCaseTimelineEntry } from "@/lib/calendarEngine/types";
import {
  calendarEventStatusLabel,
  calendarEventStatusTone,
  isPendingOwnerApproval,
  PENDING_OWNER_APPROVAL_LABEL,
} from "@/lib/calendarEngine/statusLabels";

const btnSecondarySm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6]";
const btnDangerSm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#B91C1C] bg-[#FEE2E2] px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#FECACA] disabled:cursor-not-allowed disabled:opacity-60";
const btnSuccessSm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#059669] bg-[#ECFDF5] px-3 py-2 text-sm font-black text-[#065F46] transition hover:bg-[#D1FAE5] disabled:cursor-not-allowed disabled:opacity-60";
const btnPrimarySm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#1D4ED8] bg-[#DBEAFE] px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:opacity-60";

const COMPLETION_OUTCOME_OPTIONS = [
  { value: "completed_success", label: "הושלם בהצלחה" },
  { value: "completed_early", label: "הושלם מוקדם" },
] as const;

function parsePrerequisites(raw: unknown): CalendarPrerequisite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? ""),
      label: String(item.label ?? ""),
      required: item.required !== false,
      passed: item.passed === true,
    }))
    .filter((item) => item.id.length > 0);
}

function formatEventRange(startAt: string, endAt: string, timeZone: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const date = start.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone });
  const fromTime = start.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const toTime = end.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  return `${date} · ${fromTime}–${toTime}`;
}

function formatTimelineTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

function buildRescheduleIso(date: string, time: string, durationMs: number): { startAt: string; endAt: string } {
  // מחרוזות נאיביות (בלי Z/offset) — ה-backend מפרש אותן ב-timezone של הארגון
  // וגוזר את משך האירוע מהפרש שעון-הקיר בין שתיהן (H3).
  const startAt = `${date}T${time}`;
  return { startAt, endAt: buildEndAtIso(startAt, Math.round(durationMs / 60_000)) };
}

type CalendarEventDrawerProps = {
  eventId: string | null;
  refreshKey?: number;
  onClose: () => void;
  onMutation?: () => void;
};

type DrawerClientDetails = {
  id: string;
  name: string;
  email?: string | null;
  whatsappNumber?: string | null;
};

function normalizePhoneForLinks(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const normalized = `+${trimmed.slice(1).replace(/[^\d]/g, "")}`;
    return normalized.length > 1 ? normalized : null;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

export function CalendarEventDrawer({ eventId, refreshKey = 0, onClose, onMutation }: CalendarEventDrawerProps) {
  const { t, dir } = useI18n();
  const [event, setEvent] = useState<CalendarEngineEvent | null>(null);
  const [clientDetails, setClientDetails] = useState<DrawerClientDetails | null>(null);
  const [timeline, setTimeline] = useState<WorkCaseTimelineEntry[]>([]);
  const [pendingDecisions, setPendingDecisions] = useState<OwnerDecisionQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [showNoShowForm, setShowNoShowForm] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeOutcome, setCompleteOutcome] = useState("completed_success");
  const [noShowNotes, setNoShowNotes] = useState("");
  const orgTimezone = useOrganizationTimezone();

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [evt, decisions] = await Promise.all([
        fetchCalendarEventById(id),
        fetchPendingOwnerDecisions(),
      ]);
      setEvent(evt);
      if (evt.clientId) {
        const clientResult = await apiFetch<{ client?: DrawerClientDetails }>(`/api/clients/${evt.clientId}`).catch(
          () => null
        );
        setClientDetails(clientResult?.client ?? null);
      } else {
        setClientDetails(null);
      }
      setPendingDecisions(decisions.filter((d) => d.calendarEventId === id || d.calendarEvent?.id === id));
      if (evt.workCaseId) {
        const tl = await fetchWorkCaseTimeline(evt.workCaseId);
        setTimeline(tl.items);
      } else {
        setTimeline([]);
      }
      // prefill ב-timezone הארגון — כמו שהשמירה כותבת (round-trip שלם)
      setRescheduleDate(dateInputValueInTimeZone(new Date(evt.startAt), orgTimezone));
      setRescheduleTime(timeInputValueInTimeZone(new Date(evt.startAt), orgTimezone));
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת האירוע נכשלה");
      setEvent(null);
      setClientDetails(null);
      setTimeline([]);
      setPendingDecisions([]);
    } finally {
      setLoading(false);
    }
  }, [orgTimezone]);

  useEffect(() => {
    if (!eventId) {
      setEvent(null);
      setClientDetails(null);
      setTimeline([]);
      setPendingDecisions([]);
      setShowRescheduleForm(false);
      setShowCompleteForm(false);
      setShowNoShowForm(false);
      setActionMessage(null);
      return;
    }
    load(eventId).catch(() => undefined);
  }, [eventId, refreshKey, load]);

  if (!eventId) return null;

  const prerequisites = event ? parsePrerequisites(event.prerequisitesJson) : [];
  const hasPendingDecision = pendingDecisions.length > 0;
  const showPendingBanner =
    event ? isPendingOwnerApproval(event.status) || (event.status === "confirmed" && hasPendingDecision) : false;
  const canRequestCancelOrReschedule = event?.status === "confirmed" && !hasPendingDecision;
  const eventHasStarted = event ? Date.now() >= new Date(event.startAt).getTime() : false;
  const canCompleteOrNoShow = event?.status === "confirmed" && !hasPendingDecision && eventHasStarted;
  const canMarkArrived = event?.status === "confirmed" && !hasPendingDecision;
  const clientDisplayName = clientDetails?.name ?? event?.client?.name ?? event?.title ?? t("calendar.unknownClient");
  const email = clientDetails?.email?.trim() || null;
  const phoneE164 = normalizePhoneForLinks(clientDetails?.whatsappNumber);
  const telHref = phoneE164 ? `tel:${phoneE164}` : null;
  const whatsappHref = phoneE164 ? `https://wa.me/${phoneE164.replace("+", "")}` : null;
  const mailHref = email ? `mailto:${email}` : null;

  async function handleRequestCancel() {
    if (!event) return;
    setActing(true);
    setActionMessage(null);
    setError(null);
    try {
      await requestCalendarEventCancel(event.id);
      setActionMessage(requestDecisionUserMessage());
      await load(event.id);
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "בקשת הביטול נכשלה");
    } finally {
      setActing(false);
    }
  }

  async function handleRequestReschedule(eventForm: React.FormEvent) {
    eventForm.preventDefault();
    if (!event || !rescheduleDate || !rescheduleTime) return;
    setActing(true);
    setActionMessage(null);
    setError(null);
    try {
      const durationMs = new Date(event.endAt).getTime() - new Date(event.startAt).getTime();
      const { startAt, endAt } = buildRescheduleIso(rescheduleDate, rescheduleTime, durationMs);
      await requestCalendarEventReschedule(event.id, { startAt, endAt });
      setActionMessage(requestDecisionUserMessage());
      setShowRescheduleForm(false);
      await load(event.id);
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "בקשת הדחייה נכשלה");
    } finally {
      setActing(false);
    }
  }

  async function handleComplete(eventForm: React.FormEvent) {
    eventForm.preventDefault();
    if (!event || !completeNotes.trim()) return;
    setActing(true);
    setActionMessage(null);
    setError(null);
    try {
      await completeCalendarEvent(event.id, {
        completionNotes: completeNotes.trim(),
        completionOutcome: completeOutcome,
      });
      setShowCompleteForm(false);
      await load(event.id);
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "סימון כהושלם נכשל");
    } finally {
      setActing(false);
    }
  }

  async function handleNoShow(eventForm: React.FormEvent) {
    eventForm.preventDefault();
    if (!event || !noShowNotes.trim()) return;
    setActing(true);
    setActionMessage(null);
    setError(null);
    try {
      await markCalendarEventNoShow(event.id, { notes: noShowNotes.trim() });
      setShowNoShowForm(false);
      await load(event.id);
      onMutation?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "סימון לא הגיע נכשל");
    } finally {
      setActing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label={t("calendar.eventDetails")}
      onClick={onClose}
    >
      <div
        className={`h-full w-full max-w-[460px] overflow-y-auto border border-[#E5E7EB] bg-white p-4 shadow-2xl sm:p-5 ${
          dir === "rtl" ? "rounded-l-2xl" : "rounded-r-2xl"
        }`}
        dir={dir}
        data-testid="calendar-event-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-[#111827]">{t("calendar.eventDetails")}</h2>
            {event && (
              <p className="mt-1 text-sm font-semibold text-[#6B7280]">
                {event.client?.name ?? event.title ?? t("calendar.eventDetails")}
              </p>
            )}
          </div>
          <button type="button" className={btnSecondarySm} onClick={onClose} aria-label={t("calendar.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <div className="skeleton h-32 rounded-xl" />}

        {error && (
          <p className="mb-3 text-sm font-semibold text-[#B91C1C]">{error}</p>
        )}

        {actionMessage && (
          <p className="mb-3 text-sm font-semibold text-[#7C2D12]">{actionMessage}</p>
        )}

        {event && !loading && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-[#E5E7EB] bg-gradient-to-b from-white to-[#F8FAFC] p-4 shadow-[0_8px_28px_rgba(15,23,42,0.08)]">
              <div className="mb-3 flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4338CA]">
                  <UserCircle2 className="h-7 w-7" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-2xl font-black text-[#111827]">{clientDisplayName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#6B7280]">
                    <StatusPill tone={calendarEventStatusTone(event.status)}>
                      {calendarEventStatusLabel(event.status)}
                    </StatusPill>
                    {event.service?.name ? <span>{event.service.name}</span> : <span>{t("calendar.noService")}</span>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#E5E7EB] bg-white p-3 text-sm">
                <div>
                  <p className="text-xs font-semibold text-[#6B7280]">{t("calendar.date")}</p>
                  <p className="font-black text-[#111827]">
                    {new Date(event.startAt).toLocaleDateString(dir === "rtl" ? "he-IL" : "en-US", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      timeZone: orgTimezone,
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#6B7280]">{t("calendar.time")}</p>
                  <p className="font-black text-[#111827]">
                    {new Date(event.startAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: orgTimezone,
                    })}
                    {"–"}
                    {new Date(event.endAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: orgTimezone,
                    })}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#E5E7EB] bg-white p-3">
              <h3 className="mb-2 text-sm font-black text-[#111827]">{t("calendar.quickActions")}</h3>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={telHref ?? "#"}
                  aria-disabled={!telHref}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition ${
                    telHref
                      ? "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]"
                      : "cursor-not-allowed border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
                  }`}
                  onClick={(e) => {
                    if (!telHref) e.preventDefault();
                  }}
                >
                  <Phone className="h-4 w-4" />
                  {t("calendar.call")}
                </a>
                <a
                  href={whatsappHref ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!whatsappHref}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition ${
                    whatsappHref
                      ? "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]"
                      : "cursor-not-allowed border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
                  }`}
                  onClick={(e) => {
                    if (!whatsappHref) e.preventDefault();
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  {t("calendar.whatsapp")}
                </a>
                <a
                  href={mailHref ?? "#"}
                  aria-disabled={!mailHref}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition ${
                    mailHref
                      ? "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#F3F4F6]"
                      : "cursor-not-allowed border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
                  }`}
                  onClick={(e) => {
                    if (!mailHref) e.preventDefault();
                  }}
                >
                  <Mail className="h-4 w-4" />
                  {t("calendar.email")}
                </a>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6]"
                  onClick={() => setShowRescheduleForm((v) => !v)}
                >
                  <CalendarClock className="h-4 w-4" />
                  {t("calendar.rescheduleRequest")}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#B91C1C] bg-[#FEE2E2] px-3 text-sm font-black text-[#991B1B] transition hover:bg-[#FECACA]"
                  disabled={!canRequestCancelOrReschedule || acting}
                  onClick={() => handleRequestCancel()}
                >
                  {t("calendar.cancelRequest")}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#059669] bg-[#ECFDF5] px-3 text-sm font-black text-[#065F46] transition hover:bg-[#D1FAE5]"
                  disabled={!canMarkArrived || acting}
                  onClick={() => {
                    setActionMessage(t("calendar.arrivedPlaceholder"));
                  }}
                >
                  {t("calendar.markArrived")}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 text-sm font-black text-[#991B1B] transition hover:bg-[#FEE2E2]"
                  disabled={!canCompleteOrNoShow || acting}
                  onClick={() => {
                    setShowNoShowForm((v) => !v);
                    setShowCompleteForm(false);
                  }}
                >
                  {t("calendar.markNoShow")}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6]"
                  onClick={() => setActionMessage(t("calendar.reminderPlaceholder"))}
                >
                  <BellRing className="h-4 w-4" />
                  {t("calendar.sendReminder")}
                </button>
              </div>
            </section>

            {showPendingBanner && (
              <div className="rounded-xl border border-[#C2410C] bg-[#FFEDD5] p-3 text-sm font-semibold text-[#7C2D12]">
                {PENDING_OWNER_APPROVAL_LABEL}
              </div>
            )}

            {event.workCase?.title && (
              <div className="text-xs font-semibold text-[#6B7280]">
                {t("calendar.workCase")}: {event.workCase.title}
              </div>
            )}

            <div className="flex items-start gap-2 text-sm font-semibold text-[#374151]">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
              <span>{formatEventRange(event.startAt, event.endAt, orgTimezone)}</span>
            </div>

            {event.service?.name && (
              <p className="text-sm font-semibold text-[#374151]">{t("calendar.serviceLabel")}: {event.service.name}</p>
            )}

            {canCompleteOrNoShow && (
              <div className="flex flex-wrap gap-2 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  className={btnSuccessSm}
                  disabled={acting}
                  data-testid="drawer-complete-toggle"
                  onClick={() => {
                    setShowCompleteForm((v) => !v);
                    setShowNoShowForm(false);
                  }}
                >
                  {t("calendar.markCompleted")}
                </button>
                <button
                  type="button"
                  className={btnDangerSm}
                  disabled={acting}
                  data-testid="drawer-no-show-toggle"
                  onClick={() => {
                    setShowNoShowForm((v) => !v);
                    setShowCompleteForm(false);
                  }}
                >
                  {t("calendar.markNoShow")}
                </button>
              </div>
            )}

            {showCompleteForm && canCompleteOrNoShow && (
              <form onSubmit={handleComplete} className="space-y-3 rounded-xl border border-[#059669]/30 bg-[#ECFDF5] p-3">
                <p className="text-sm font-black text-[#065F46]">סימון אירוע כהושלם</p>
                <label className="block text-sm font-semibold">
                  סיכום
                  <textarea
                    required
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-2"
                    value={completeNotes}
                    onChange={(e) => setCompleteNotes(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-semibold">
                  תוצאה
                  <select
                    required
                    className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-2"
                    value={completeOutcome}
                    onChange={(e) => setCompleteOutcome(e.target.value)}
                  >
                    {COMPLETION_OUTCOME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={btnSuccessSm} disabled={acting} data-testid="drawer-complete-submit">
                  שמור השלמה
                </button>
              </form>
            )}

            {showNoShowForm && canCompleteOrNoShow && (
              <form onSubmit={handleNoShow} className="space-y-3 rounded-xl border border-[#FEE2E2] bg-[#FEF2F2] p-3">
                <p className="text-sm font-black text-[#991B1B]">הלקוח לא הגיע</p>
                <label className="block text-sm font-semibold">
                  סיבה / הערה
                  <textarea
                    required
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-2"
                    value={noShowNotes}
                    onChange={(e) => setNoShowNotes(e.target.value)}
                  />
                </label>
                <button type="submit" className={btnDangerSm} disabled={acting} data-testid="drawer-no-show-submit">
                  שמור לא הגיע
                </button>
              </form>
            )}

            {canRequestCancelOrReschedule && <div className="border-t border-[#E5E7EB] pt-2" />}

            {showRescheduleForm && canRequestCancelOrReschedule && (
              <form onSubmit={handleRequestReschedule} className="space-y-3 rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <p className="text-sm font-black text-[#111827]">{t("calendar.newProposedTime")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm font-semibold">
                    {t("calendar.date")}
                    <input
                      type="date"
                      required
                      className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-2"
                      value={rescheduleDate}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    {t("calendar.time")}
                    <input
                      type="time"
                      required
                      className="mt-1 w-full rounded-xl border border-[#E5E7EB] px-3 py-2"
                      value={rescheduleTime}
                      onChange={(e) => setRescheduleTime(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  className={btnPrimarySm}
                  disabled={acting}
                  data-testid="drawer-reschedule-submit"
                >
                  {t("calendar.submitForApproval")}
                </button>
              </form>
            )}

            {prerequisites.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-black text-[#111827]">{t("calendar.prerequisites")}</h3>
                <ul className="space-y-2">
                  {prerequisites.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm font-semibold"
                    >
                      {item.passed ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#059669]" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full border-2 border-[#D1D5DB]" />
                      )}
                      <span className={item.passed ? "text-[#065F46]" : "text-[#374151]"}>
                        {item.label}
                        {item.required === false ? ` (${t("calendar.optional")})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {event.status === "completed" && (
              <div className="rounded-xl border border-[#059669]/30 bg-[#ECFDF5] p-3">
                <p className="text-sm font-black text-[#065F46]">{t("calendar.completed")}</p>
                {event.completionOutcome && (
                  <p className="mt-1 text-sm font-semibold text-[#047857]">{event.completionOutcome}</p>
                )}
                {event.completionNotes && (
                  <p className="mt-1 text-sm font-semibold text-[#065F46]">{event.completionNotes}</p>
                )}
              </div>
            )}

            {event.status === "no_show" && (
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] p-3">
                <p className="text-sm font-black text-[#374151]">{t("calendar.noShow")}</p>
                {event.completionNotes && (
                  <p className="mt-1 text-sm font-semibold text-[#6B7280]">{event.completionNotes}</p>
                )}
              </div>
            )}

            {timeline.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-black text-[#111827]">{t("calendar.workCaseTimeline")}</h3>
                <ol className="space-y-2 border-r-2 border-[#E5E7EB] pr-3">
                  {timeline.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p className="font-semibold text-[#111827]">{entry.summary}</p>
                      <p className="text-xs font-semibold text-[#6B7280]">{formatTimelineTime(entry.createdAt, orgTimezone)}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
