"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import {
  Button,
  buttonVariants,
  EmptyState,
  FormLabel,
  Input,
  Select,
  SlidePanel,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/natalie-ui";
import { apiFetch } from "@/lib/api";
import type { BusinessCrmField } from "@/lib/business-config";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  callHref,
  channelLabel,
  crmSources,
  crmStages,
  emailHref,
  formatAppointmentDateTime,
  sourceLabel,
  statusLabel,
  timelineTypeLabel,
  toDateTimeLocal,
  whatsappHref,
} from "./crmHelpers";
import type { CrmAppointment, CrmProfileTab, Lead } from "./types";

function crmFieldMap(fields: BusinessCrmField[]) {
  const fallback: Record<BusinessCrmField["key"], BusinessCrmField> = {
    name: { key: "name", label: "שם", placeholder: "שם מלא" },
    company: { key: "company", label: "חברה", placeholder: "שם חברה או הקשר" },
    phone: { key: "phone", label: "טלפון", placeholder: "+972..." },
    email: { key: "email", label: "מייל", placeholder: "client@example.com" },
    estimatedValue: { key: "estimatedValue", label: "ערך עסקה", placeholder: "0" },
    tags: { key: "tags", label: "תגיות", placeholder: "דחוף, המלצה, לקוח חשוב" },
    notes: { key: "notes", label: "הערות", placeholder: "הערות פנימיות" },
  };
  return fields.reduce((acc, field) => ({ ...acc, [field.key]: field }), fallback);
}

export function CrmProfilePanel({
  lead,
  open,
  onClose,
  crmFields,
  timelineText,
  setTimelineText,
  onUpdate,
  onMarkReply,
  onAddTimeline,
  labels,
  locale,
  onScheduleAppointment,
}: {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  crmFields: BusinessCrmField[];
  timelineText: string;
  setTimelineText: (value: string) => void;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onMarkReply: (lead: Lead, replyMessage: string) => Promise<void>;
  onAddTimeline: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  labels: Record<string, string>;
  locale: string;
  onScheduleAppointment: () => void;
}) {
  const [tab, setTab] = useState<CrmProfileTab>("details");
  const [saving, setSaving] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [appointments, setAppointments] = useState<CrmAppointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [expandedAppointmentId, setExpandedAppointmentId] = useState<string | null>(null);
  const crmLabels = useMemo(() => crmFieldMap(crmFields), [crmFields]);

  const leadId = lead?.id;
  useEffect(() => {
    if (!leadId) {
      setAppointments([]);
      return;
    }
    let active = true;
    setAppointmentsLoading(true);
    setExpandedAppointmentId(null);
    apiFetch<{ appointments: CrmAppointment[] }>(`/api/leads/${leadId}/appointments`)
      .then((result) => {
        if (active) setAppointments(result.appointments);
      })
      .catch(() => {
        if (active) setAppointments([]);
      })
      .finally(() => {
        if (active) setAppointmentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  const { nextAppointment, upcomingAppointments, pastAppointments } = useMemo(() => {
    const now = Date.now();
    const parsed = appointments.map((item) => ({ item, ts: new Date(item.startTime).getTime() }));
    const upcoming = parsed
      .filter((entry) => entry.item.status !== "cancelled" && entry.ts >= now)
      .sort((a, b) => a.ts - b.ts);
    const upcomingIds = new Set(upcoming.map((entry) => entry.item.id));
    const past = parsed
      .filter((entry) => !upcomingIds.has(entry.item.id))
      .sort((a, b) => b.ts - a.ts);
    return {
      nextAppointment: upcoming[0]?.item ?? null,
      upcomingAppointments: upcoming.slice(1).map((entry) => entry.item),
      pastAppointments: past.map((entry) => entry.item),
    };
  }, [appointments]);

  const [draft, setDraft] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    whatsapp: "",
    source: "manual",
    estimatedValue: "",
    assignedTo: "",
    tags: "",
    notes: "",
    nextReminderAt: "",
    attachments: "",
  });

  useEffect(() => {
    if (!lead) return;
    setDraft({
      name: lead.name,
      company: lead.company ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      whatsapp: lead.whatsapp ?? "",
      source: lead.source,
      estimatedValue: String(lead.estimatedValue || ""),
      assignedTo: lead.assignedTo ?? "",
      tags: lead.tags.join(", "),
      notes: lead.notes ?? "",
      nextReminderAt: lead.nextReminderAt ? toDateTimeLocal(lead.nextReminderAt) : "",
      attachments: lead.attachments.join(", "),
    });
    setTab("details");
  }, [lead]);

  if (!lead) return null;

  const currentLead = lead;

  const tabItems: Array<{ id: CrmProfileTab; label: string }> = [
    { id: "details", label: labels.tabDetails },
    { id: "timeline", label: labels.tabTimeline },
    { id: "appointments", label: labels.tabAppointments },
    { id: "documents", label: labels.tabDocuments },
    { id: "payments", label: labels.tabPayments },
    { id: "notes", label: labels.tabNotes },
    { id: "tasks", label: labels.tabTasks },
    { id: "whatsapp", label: labels.tabWhatsapp },
  ];

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onUpdate(currentLead.id, {
        name: draft.name,
        company: draft.company,
        phone: draft.phone,
        email: draft.email,
        whatsapp: draft.whatsapp,
        source: draft.source,
        estimatedValue: Number(draft.estimatedValue || 0),
        assignedTo: draft.assignedTo,
        tags: draft.tags,
        notes: draft.notes,
        nextReminderAt: draft.nextReminderAt || null,
        attachments: draft.attachments.split(",").map((item) => item.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  }

  async function markReply() {
    setSaving(true);
    try {
      await onMarkReply(currentLead, replyText);
      setReplyText("");
    } finally {
      setSaving(false);
    }
  }

  const wa = whatsappHref(currentLead);
  const tel = callHref(currentLead);
  const mailto = emailHref(currentLead);
  const emailAddress = currentLead.email?.trim() ?? "";

  return (
    <SlidePanel
      open={open}
      title={currentLead.name}
      subtitle={currentLead.company || currentLead.phone || currentLead.email || undefined}
      onClose={onClose}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" type="button" onClick={() => setTab("details")}>
            {labels.edit}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setTab("tasks")}>
            {labels.addTask}
          </Button>
          <Button variant="ghost" type="button" onClick={onScheduleAppointment}>
            {labels.scheduleAppointment}
          </Button>
        </div>
      }
    >
      <div className="mb-4 overflow-x-auto">
        <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel={labels.tabDetails} />
      </div>

      {tab === "details" ? (
        <div className="grid gap-4">
          {nextAppointment ? (
            <button
              type="button"
              onClick={() => setTab("appointments")}
              className="w-full rounded-2xl border border-[#2563EB] bg-[#EFF6FF] p-4 text-start dark:bg-[#0F1E42]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1D4ED8] dark:text-[#93C5FD]">{labels.nextAppointment}</p>
                  <p className="mt-1 text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">
                    {formatAppointmentDateTime(nextAppointment.startTime, locale)}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-[var(--natalie-text-muted,#64748B)]">
                    {nextAppointment.service?.name || labels.noService}
                    {nextAppointment.employee?.name ? ` · ${nextAppointment.employee.name}` : ""}
                  </p>
                </div>
                <StatusBadge tone={appointmentStatusTone(nextAppointment.status)}>
                  {appointmentStatusLabel(nextAppointment.status)}
                </StatusBadge>
              </div>
            </button>
          ) : null}
          <div className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-4">
            <p className="text-xs font-bold text-[var(--natalie-text-muted,#64748B)]">{labels.email}</p>
            {mailto ? (
              <a
                href={mailto}
                dir="ltr"
                className="mt-1 block truncate text-sm font-semibold text-[#2563EB] underline"
              >
                {emailAddress}
              </a>
            ) : (
              <p className="mt-1 text-sm font-semibold text-[var(--natalie-text-muted,#64748B)]">{labels.notProvided}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {tel ? (
                <a href={tel} aria-label={labels.call} className={buttonVariants.secondarySm}>
                  <Phone className="h-4 w-4" />
                  {labels.call}
                </a>
              ) : (
                <Button variant="secondary" size="sm" type="button" disabled>
                  <Phone className="h-4 w-4" />
                  {labels.call}
                </Button>
              )}
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={labels.whatsapp}
                  className={buttonVariants.secondarySm}
                >
                  <MessageCircle className="h-4 w-4" />
                  {labels.whatsapp}
                </a>
              ) : (
                <Button variant="secondary" size="sm" type="button" disabled>
                  <MessageCircle className="h-4 w-4" />
                  {labels.whatsapp}
                </Button>
              )}
              {mailto ? (
                <a href={mailto} aria-label={labels.sendEmail} className={buttonVariants.secondarySm}>
                  <Mail className="h-4 w-4" />
                  {labels.sendEmail}
                </a>
              ) : (
                <Button variant="secondary" size="sm" type="button" disabled>
                  <Mail className="h-4 w-4" />
                  {labels.sendEmail}
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {crmStages.map((stage) => (
              <Button
                key={stage}
                variant={currentLead.stage === stage ? "primary" : "secondary"}
                size="sm"
                type="button"
                onClick={() => onUpdate(currentLead.id, { stage })}
              >
                {stage}
              </Button>
            ))}
          </div>
          <form onSubmit={saveDetails} className="grid gap-3">
            <FormLabel>
              {crmLabels.name.label}
              <Input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={crmLabels.name.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {crmLabels.company.label}
              <Input
                value={draft.company}
                onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                placeholder={crmLabels.company.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {labels.source}
              <Select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
                {crmSources.map((source) => (
                  <option key={source} value={source}>
                    {sourceLabel(source)}
                  </option>
                ))}
              </Select>
            </FormLabel>
            <FormLabel>
              {crmLabels.phone.label}
              <Input
                dir="ltr"
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                placeholder={crmLabels.phone.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {labels.whatsapp}
              <Input
                dir="ltr"
                value={draft.whatsapp}
                onChange={(event) => setDraft({ ...draft, whatsapp: event.target.value })}
              />
            </FormLabel>
            <FormLabel>
              {crmLabels.email.label}
              <Input
                dir="ltr"
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                placeholder={crmLabels.email.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {crmLabels.estimatedValue.label}
              <Input
                type="number"
                value={draft.estimatedValue}
                onChange={(event) => setDraft({ ...draft, estimatedValue: event.target.value })}
                placeholder={crmLabels.estimatedValue.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {labels.assignedTo}
              <Input
                value={draft.assignedTo}
                onChange={(event) => setDraft({ ...draft, assignedTo: event.target.value })}
              />
            </FormLabel>
            <FormLabel>
              {labels.nextReminder}
              <Input
                type="datetime-local"
                value={draft.nextReminderAt}
                onChange={(event) => setDraft({ ...draft, nextReminderAt: event.target.value })}
              />
            </FormLabel>
            <FormLabel>
              {crmLabels.tags.label}
              <Input
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                placeholder={crmLabels.tags.placeholder}
              />
            </FormLabel>
            <FormLabel>
              {labels.attachments}
              <Input
                value={draft.attachments}
                onChange={(event) => setDraft({ ...draft, attachments: event.target.value })}
                placeholder={labels.attachmentsPlaceholder}
              />
            </FormLabel>
            <Button type="submit" disabled={saving}>
              {saving ? labels.saving : labels.saveDetails}
            </Button>
          </form>
        </div>
      ) : null}

      {tab === "timeline" ? (
        <div className="grid gap-3">
          {currentLead.timeline.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-3"
            >
              <strong className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">
                {timelineTypeLabel(item.type)}
              </strong>
              <p className="mt-1 text-sm text-[var(--natalie-text-primary,#0F172A)]">{item.content}</p>
              <small className="text-xs text-[var(--natalie-text-muted,#64748B)]">
                {new Date(item.createdAt).toLocaleString(locale)}
              </small>
            </div>
          ))}
          {currentLead.timeline.length === 0 ? <EmptyState title={labels.emptyTimeline} /> : null}
          <form onSubmit={onAddTimeline} className="grid gap-2">
            <Textarea
              value={timelineText}
              onChange={(event) => setTimelineText(event.target.value)}
              placeholder={labels.addNotePlaceholder}
            />
            <Button type="submit">{labels.addToTimeline}</Button>
          </form>
        </div>
      ) : null}

      {tab === "appointments" ? (
        appointmentsLoading ? (
          <p className="text-sm text-[var(--natalie-text-muted,#64748B)]">{labels.appointmentsLoading}</p>
        ) : appointments.length === 0 ? (
          <EmptyState title={labels.emptyAppointments} />
        ) : (
          <div className="grid gap-4">
            {nextAppointment ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">{labels.nextAppointment}</h3>
                <AppointmentRow
                  appointment={nextAppointment}
                  locale={locale}
                  labels={labels}
                  highlighted
                  expanded={expandedAppointmentId === nextAppointment.id}
                  onToggle={() =>
                    setExpandedAppointmentId((current) => (current === nextAppointment.id ? null : nextAppointment.id))
                  }
                />
              </section>
            ) : null}
            {upcomingAppointments.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">{labels.upcomingAppointments}</h3>
                {upcomingAppointments.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    locale={locale}
                    labels={labels}
                    expanded={expandedAppointmentId === appointment.id}
                    onToggle={() =>
                      setExpandedAppointmentId((current) => (current === appointment.id ? null : appointment.id))
                    }
                  />
                ))}
              </section>
            ) : null}
            {pastAppointments.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">{labels.pastAppointments}</h3>
                {pastAppointments.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    locale={locale}
                    labels={labels}
                    expanded={expandedAppointmentId === appointment.id}
                    onToggle={() =>
                      setExpandedAppointmentId((current) => (current === appointment.id ? null : appointment.id))
                    }
                  />
                ))}
              </section>
            ) : null}
          </div>
        )
      ) : null}
      {tab === "documents" ? <EmptyState title={labels.emptyDocuments} description={labels.comingSoon} /> : null}
      {tab === "payments" ? <EmptyState title={labels.emptyPayments} description={labels.comingSoon} /> : null}

      {tab === "notes" ? (
        <div className="grid gap-3">
          {currentLead.notes ? (
            <p className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-4 text-sm">
              {currentLead.notes}
            </p>
          ) : (
            <EmptyState title={labels.emptyNotes} />
          )}
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="grid gap-3">
          {currentLead.nextReminderAt ? (
            <div className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-4">
              <p className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">{labels.nextReminder}</p>
              <p className="mt-1 text-sm">{new Date(currentLead.nextReminderAt).toLocaleString(locale)}</p>
            </div>
          ) : (
            <EmptyState title={labels.emptyTasks} />
          )}
          <Button variant="secondary" type="button" onClick={() => setTab("details")}>
            {labels.addTask}
          </Button>
        </div>
      ) : null}

      {tab === "whatsapp" ? (
        <div className="grid gap-3">
          <div className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-4">
            <FormLabel>
              {labels.markReply}
              <Textarea
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder={labels.replyPlaceholder}
              />
            </FormLabel>
            <Button
              className="mt-2"
              type="button"
              onClick={markReply}
              disabled={saving || (!currentLead.phone && !currentLead.whatsapp && !currentLead.email)}
            >
              {labels.stopSequence}
            </Button>
          </div>
          {currentLead.sequences.map((sequence) => (
            <div
              key={sequence.id}
              className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-3"
            >
              <strong className="text-sm font-black">{sequence.template}</strong>
              <p className="text-sm text-[var(--natalie-text-muted,#64748B)]">
                {channelLabel(sequence.channel)} · {statusLabel(sequence.status)}
              </p>
              <small className="text-xs text-[var(--natalie-text-muted,#64748B)]">
                {new Date(sequence.scheduledAt).toLocaleString(locale)}
              </small>
            </div>
          ))}
          {currentLead.sequences.length === 0 ? <EmptyState title={labels.emptyWhatsapp} /> : null}
        </div>
      ) : null}
    </SlidePanel>
  );
}

function AppointmentRow({
  appointment,
  locale,
  labels,
  expanded,
  onToggle,
  highlighted = false,
}: {
  appointment: CrmAppointment;
  locale: string;
  labels: Record<string, string>;
  expanded: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`w-full rounded-2xl border p-3 text-start transition ${
        highlighted
          ? "border-[#2563EB] bg-[#EFF6FF] dark:bg-[#0F1E42]"
          : "border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-[var(--natalie-text-primary,#0F172A)]">
            {formatAppointmentDateTime(appointment.startTime, locale)}
          </p>
          <p className="mt-0.5 truncate text-sm text-[var(--natalie-text-muted,#64748B)]">
            {appointment.service?.name || labels.noService}
            {appointment.employee?.name ? ` · ${appointment.employee.name}` : ""}
          </p>
        </div>
        <StatusBadge tone={appointmentStatusTone(appointment.status)}>
          {appointmentStatusLabel(appointment.status)}
        </StatusBadge>
      </div>
      {expanded ? (
        <dl className="mt-3 grid gap-1 border-t border-[var(--natalie-border,#D9E2F2)] pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.service}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">
              {appointment.service?.name || labels.noService}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.employee}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">
              {appointment.employee?.name || labels.owner}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.duration}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">
              {appointment.durationMinutes} {labels.minutes}
            </dd>
          </div>
          {appointment.notes ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.tabNotes}</dt>
              <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">{appointment.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </button>
  );
}
