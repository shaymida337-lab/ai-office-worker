"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  applyQuickFilter,
  computeCrmKpis,
  countUntreatedThisWeek,
  CrmCustomerCard,
  CrmFilterChips,
  CrmNatalieInsightCard,
  CrmProfilePanel,
  crmSources,
  sourceLabel,
  type CrmQuickFilter,
  type Lead,
} from "@/components/crm";
import { channelLabel } from "@/components/crm/crmHelpers";
import {
  AppShell,
  Button,
  Card,
  EmptyState,
  FloatingActionButton,
  FormLabel,
  Input,
  KpiCard,
  MessageBanner,
  PageTitle,
  Select,
  SkeletonCard,
  Textarea,
} from "@/components/natalie-ui";
import { useI18n } from "@/i18n";
import { apiFetch } from "@/lib/api";
import { getBusinessProfile, type BusinessCrmField, type OrganizationSettings } from "@/lib/business-config";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

type CrmResponse = {
  leads: Lead[];
  kpis: { newToday: number; responseRate: number; avgCloseDays: number; pipelineValue: number };
  pipeline: Array<{ stage: string; count: number; value: number; conversionFromPrevious: number }>;
};

type MessageTemplate = { id: string; name: string; channel: string; content: string; variables: string[] };

const emptyForm = {
  name: "",
  phone: "",
  source: "manual",
  company: "",
  email: "",
  estimatedValue: "",
  tags: "",
  notes: "",
};

export default function CrmPage() {
  const router = useRouter();
  const { t, dir, language } = useI18n();
  const locale = language === "he" ? "he-IL" : "en-US";

  const [data, setData] = useState<CrmResponse | null>(null);
  const [quickFilter, setQuickFilter] = useState<CrmQuickFilter>("all");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [timelineText, setTimelineText] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    source: "all",
    stage: "all",
    minValue: "",
    maxValue: "",
    assignedTo: "",
    from: "",
    to: "",
    sortBy: "updatedAt",
    sortDir: "desc",
  });

  async function load() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== "all") params.set(key, value);
    }
    const result = await apiFetch<CrmResponse>(`/api/leads${params.toString() ? `?${params.toString()}` : ""}`);
    setData(result);
  }

  async function loadTemplates() {
    const result = await apiFetch<{ templates: MessageTemplate[] }>("/api/leads/templates");
    setTemplates(result.templates);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err instanceof Error ? err.message : t("crmDesign.loading")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.source, filters.stage, filters.minValue, filters.maxValue, filters.assignedTo, filters.from, filters.to, filters.sortBy, filters.sortDir]);

  useEffect(() => {
    loadTemplates().catch(() => undefined);
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then(setOrganizationSettings)
      .catch(() => undefined);
  }, []);

  const filteredLeads = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const leads = data?.leads ?? [];
    const searched = !query
      ? leads
      : leads.filter((lead) =>
          `${lead.name} ${lead.company ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""}`.toLowerCase().includes(query)
        );
    return applyQuickFilter(searched, quickFilter);
  }, [data?.leads, filters.search, quickFilter]);

  const untreatedCount = useMemo(() => countUntreatedThisWeek(data?.leads ?? []), [data?.leads]);
  const kpiValues = useMemo(() => computeCrmKpis(data?.leads ?? []), [data?.leads]);

  const businessProfile = useMemo(() => getBusinessProfile(organizationSettings?.businessType), [organizationSettings]);
  const crmLabels = useMemo(() => crmFieldMap(businessProfile.crmFields), [businessProfile.crmFields]);

  const filterLabels = useMemo(
    () => ({
      all: t("crmDesign.filterAll"),
      leads: t("crmDesign.filterLeads"),
      customers: t("crmDesign.filterCustomers"),
      pending: t("crmDesign.filterPending"),
      followup: t("crmDesign.filterFollowup"),
    }),
    [t]
  );

  const profileLabels = useMemo(
    () => ({
      tabDetails: t("crmDesign.profile.tabDetails"),
      tabTimeline: t("crmDesign.profile.tabTimeline"),
      tabAppointments: t("crmDesign.profile.tabAppointments"),
      tabDocuments: t("crmDesign.profile.tabDocuments"),
      tabPayments: t("crmDesign.profile.tabPayments"),
      tabNotes: t("crmDesign.profile.tabNotes"),
      tabTasks: t("crmDesign.profile.tabTasks"),
      tabWhatsapp: t("crmDesign.profile.tabWhatsapp"),
      edit: t("crmDesign.profile.edit"),
      addTask: t("crmDesign.profile.addTask"),
      sendWhatsapp: t("crmDesign.profile.sendWhatsapp"),
      scheduleAppointment: t("crmDesign.profile.scheduleAppointment"),
      source: t("crmDesign.source"),
      whatsapp: t("crmDesign.whatsapp"),
      assignedTo: t("crmDesign.profile.assignedTo"),
      nextReminder: t("crmDesign.profile.nextReminder"),
      attachments: t("crmDesign.profile.attachments"),
      attachmentsPlaceholder: t("crmDesign.profile.attachmentsPlaceholder"),
      saveDetails: t("crmDesign.profile.saveDetails"),
      saving: t("crmDesign.saving"),
      emptyTimeline: t("crmDesign.profile.emptyTimeline"),
      addNotePlaceholder: t("crmDesign.profile.addNotePlaceholder"),
      addToTimeline: t("crmDesign.profile.addToTimeline"),
      emptyAppointments: t("crmDesign.profile.emptyAppointments"),
      emptyDocuments: t("crmDesign.profile.emptyDocuments"),
      emptyPayments: t("crmDesign.profile.emptyPayments"),
      emptyNotes: t("crmDesign.profile.emptyNotes"),
      emptyTasks: t("crmDesign.profile.emptyTasks"),
      emptyWhatsapp: t("crmDesign.profile.emptyWhatsapp"),
      comingSoon: t("crmDesign.profile.comingSoon"),
      markReply: t("crmDesign.profile.markReply"),
      replyPlaceholder: t("crmDesign.profile.replyPlaceholder"),
      stopSequence: t("crmDesign.profile.stopSequence"),
    }),
    [t]
  );

  async function createLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await apiFetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          estimatedValue: Number(form.estimatedValue || 0),
          tags: form.tags,
          whatsapp: form.phone,
        }),
      });
      setForm(emptyForm);
      setShowForm(false);
      setMessage("הליד נוסף ורצף ההודעות הופעל אוטומטית");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת ליד נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function updateLead(id: string, body: Record<string, unknown>) {
    const updated = await apiFetch<Lead>(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify(body) });
    setSelected((current) => (current?.id === id ? updated : current));
    await load();
  }

  async function markLeadReply(lead: Lead, replyMessage: string) {
    const result = await apiFetch<{ lead: Lead }>("/api/leads/reply", {
      method: "POST",
      body: JSON.stringify({
        phone: lead.phone || lead.whatsapp,
        email: lead.email,
        channel: lead.phone || lead.whatsapp ? "whatsapp" : "email",
        message: replyMessage || "סומן ידנית שהליד ענה",
      }),
    });
    setSelected(result.lead);
    setMessage("הליד סומן כענה ורצף ההודעות נעצר");
    await load();
  }

  async function addTimeline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !timelineText.trim()) return;
    try {
      await apiFetch(`/api/leads/${selected.id}/timeline`, {
        method: "POST",
        body: JSON.stringify({ type: "note", content: timelineText }),
      });
      const refreshed = await apiFetch<Lead>(`/api/leads/${selected.id}`);
      setSelected(refreshed);
      setTimelineText("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "שמירת הערה נכשלה");
    }
  }

  async function scanGmailLeads() {
    setSaving(true);
    setMessage("");
    try {
      const result = await apiFetch<{ scanned: number; created: number }>("/api/leads/scan-gmail", { method: "POST" });
      setMessage(`נסרקו ${result.scanned} מיילים ונוצרו ${result.created} לידים`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "סריקת לידים מג׳ימייל נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(id: string, content: string) {
    const updated = await apiFetch<MessageTemplate>(`/api/leads/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    setTemplates((current) => current.map((template) => (template.id === id ? updated : template)));
    setMessage("תבנית ההודעה נשמרה");
  }

  function showUntreatedLeads() {
    setQuickFilter("leads");
    setFilters((current) => ({ ...current, stage: "all", search: "" }));
  }

  function createFollowUpTask() {
    setQuickFilter("followup");
    openNatalieAssistant(t("crmDesign.createFollowUp"));
  }

  const hasActiveFilters = quickFilter !== "all" || Boolean(filters.search) || filters.source !== "all" || filters.stage !== "all";

  return (
    <div dir={dir}>
      <AppShell
        pageTitle={<PageTitle title={t("crmDesign.title")} subtitle={t("crmDesign.subtitle")} />}
        floatingButton={
          <FloatingActionButton
            label={t("crmDesign.floatingNatalie")}
            onClick={() => openNatalieAssistant(t("crmDesign.floatingNatalie"))}
          />
        }
      >
        {message ? (
          <MessageBanner tone="info" className="mb-4">
            {message}
          </MessageBanner>
        ) : null}

        <div className="grid gap-4">
          {untreatedCount > 0 ? (
            <CrmNatalieInsightCard
              message={t("crmDesign.insightMessage", { count: untreatedCount })}
              primaryLabel={t("crmDesign.showLeads")}
              secondaryLabel={t("crmDesign.createFollowUp")}
              onPrimary={showUntreatedLeads}
              onSecondary={createFollowUpTask}
            />
          ) : null}

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label={t("crmDesign.kpiActive")} value={String(kpiValues.activeCustomers)} />
            <KpiCard label={t("crmDesign.kpiNewLeads")} value={String(kpiValues.newLeads)} />
            <KpiCard label={t("crmDesign.kpiOpenTasks")} value={String(kpiValues.openTasks)} />
            <KpiCard label={t("crmDesign.kpiUnattended")} value={String(kpiValues.unattended)} />
          </section>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" type="button" onClick={() => setShowForm((open) => !open)}>
              <Plus className="h-4 w-4" />
              {t("crmDesign.addCustomer")}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setTemplatesOpen((open) => !open)}>
              {t("crmDesign.templates")}
            </Button>
            <Button variant="secondary" type="button" onClick={scanGmailLeads} disabled={saving}>
              {t("crmDesign.scanGmail")}
            </Button>
          </div>

          <CrmFilterChips value={quickFilter} onChange={setQuickFilter} labels={filterLabels} />

          {showForm ? (
            <Card>
              <form onSubmit={createLead} className="grid gap-3 md:grid-cols-2">
                <FormLabel>
                  {crmLabels.name.label}
                  <Input
                    required
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder={crmLabels.name.placeholder}
                  />
                </FormLabel>
                <FormLabel>
                  {crmLabels.phone.label}
                  <Input
                    required
                    dir="ltr"
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    placeholder={crmLabels.phone.placeholder}
                  />
                </FormLabel>
                <FormLabel>
                  {t("crmDesign.source")}
                  <Select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
                    {crmSources.map((source) => (
                      <option key={source} value={source}>
                        {sourceLabel(source)}
                      </option>
                    ))}
                  </Select>
                </FormLabel>
                <FormLabel>
                  {crmLabels.company.label}
                  <Input
                    value={form.company}
                    onChange={(event) => setForm({ ...form, company: event.target.value })}
                    placeholder={crmLabels.company.placeholder}
                  />
                </FormLabel>
                <FormLabel>
                  {crmLabels.email.label}
                  <Input
                    dir="ltr"
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    placeholder={crmLabels.email.placeholder}
                  />
                </FormLabel>
                <FormLabel>
                  {crmLabels.estimatedValue.label}
                  <Input
                    type="number"
                    value={form.estimatedValue}
                    onChange={(event) => setForm({ ...form, estimatedValue: event.target.value })}
                    placeholder={crmLabels.estimatedValue.placeholder}
                  />
                </FormLabel>
                <FormLabel className="md:col-span-2">
                  {crmLabels.tags.label}
                  <Input
                    value={form.tags}
                    onChange={(event) => setForm({ ...form, tags: event.target.value })}
                    placeholder={crmLabels.tags.placeholder}
                  />
                </FormLabel>
                <FormLabel className="md:col-span-2">
                  {crmLabels.notes.label}
                  <Input
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    placeholder={crmLabels.notes.placeholder}
                  />
                </FormLabel>
                <Button type="submit" disabled={saving} className="md:col-span-2">
                  {saving ? t("crmDesign.saving") : t("crmDesign.saveAndSequence")}
                </Button>
              </form>
            </Card>
          ) : null}

          {templatesOpen ? <TemplatePanel templates={templates} onSave={saveTemplate} /> : null}

          {!data ? (
            <div className="grid gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : filteredLeads.length === 0 ? (
            <EmptyState
              title={hasActiveFilters ? t("crmDesign.emptyFiltered") : t("crmDesign.emptyTitle")}
              description={hasActiveFilters ? t("crmDesign.emptyFilteredHint") : undefined}
              action={
                !hasActiveFilters ? (
                  <Button type="button" onClick={() => setShowForm(true)}>
                    {t("crmDesign.emptyCta")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <section className="grid gap-3">
              {filteredLeads.map((lead) => (
                <CrmCustomerCard
                  key={lead.id}
                  lead={lead}
                  locale={locale}
                  labels={{
                    lastInteraction: t("crmDesign.lastInteraction"),
                    nextTask: t("crmDesign.nextTask"),
                    source: t("crmDesign.source"),
                    whatsapp: t("crmDesign.whatsapp"),
                    call: t("crmDesign.call"),
                    openProfile: t("crmDesign.openProfile"),
                  }}
                  onOpen={() => setSelected(lead)}
                />
              ))}
            </section>
          )}
        </div>

        <CrmProfilePanel
          lead={selected}
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          crmFields={businessProfile.crmFields}
          timelineText={timelineText}
          setTimelineText={setTimelineText}
          onUpdate={updateLead}
          onMarkReply={markLeadReply}
          onAddTimeline={addTimeline}
          labels={profileLabels}
          locale={locale}
          onScheduleAppointment={() => router.push("/dashboard/calendar")}
        />
      </AppShell>
    </div>
  );
}

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

function TemplatePanel({ templates, onSave }: { templates: MessageTemplate[]; onSave: (id: string, content: string) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");

  async function save(template: MessageTemplate) {
    setSavingId(template.id);
    try {
      await onSave(template.id, drafts[template.id] ?? template.content);
    } finally {
      setSavingId("");
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-black text-[var(--natalie-text-primary,#0F172A)]">תבניות רצף הודעות</h2>
        <span className="rounded-full bg-[#ECFDF5] px-3 py-1 text-xs font-bold text-[#065F46]">{templates.length}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <div
            key={template.id}
            className="rounded-2xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <strong>{template.name}</strong>
              <span className="rounded-full border border-[#FCD34D] bg-[#FFFBEB] px-3 py-1 text-xs font-bold text-[#92400E]">
                {channelLabel(template.channel)}
              </span>
            </div>
            <Textarea
              className="min-h-44"
              value={drafts[template.id] ?? template.content}
              onChange={(event) => setDrafts((current) => ({ ...current, [template.id]: event.target.value }))}
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <small className="text-[var(--natalie-text-muted,#64748B)]">משתנים: {template.variables.join(", ") || "אין"}</small>
              <Button type="button" onClick={() => save(template)} disabled={savingId === template.id}>
                {savingId === template.id ? "שומר..." : "שמור תבנית"}
              </Button>
            </div>
          </div>
        ))}
        {templates.length === 0 ? <p>אין תבניות להצגה.</p> : null}
      </div>
    </Card>
  );
}
