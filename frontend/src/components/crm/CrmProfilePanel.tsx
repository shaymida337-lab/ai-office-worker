"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  EmptyState,
  FormLabel,
  Input,
  Select,
  SlidePanel,
  Tabs,
  Textarea,
} from "@/components/natalie-ui";
import type { BusinessCrmField } from "@/lib/business-config";
import {
  channelLabel,
  crmSources,
  crmStages,
  sourceLabel,
  statusLabel,
  timelineTypeLabel,
  toDateTimeLocal,
  whatsappHref,
} from "./crmHelpers";
import type { CrmProfileTab, Lead } from "./types";

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
  const crmLabels = useMemo(() => crmFieldMap(crmFields), [crmFields]);

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
          {wa ? (
            <Button variant="secondary" type="button" onClick={() => window.open(wa, "_blank")}>
              {labels.sendWhatsapp}
            </Button>
          ) : (
            <Button variant="secondary" type="button" disabled>
              {labels.sendWhatsapp}
            </Button>
          )}
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

      {tab === "appointments" ? <EmptyState title={labels.emptyAppointments} description={labels.comingSoon} /> : null}
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
