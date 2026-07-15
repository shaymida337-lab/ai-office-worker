"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Upload, X } from "lucide-react";
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
import { ImportClientsDialog } from "@/components/clients/ImportClientsDialog";
import {
  AppShell,
  Button,
  Card,
  EmptyState,
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
import { getBusinessModule, type BusinessModuleConfig } from "@/lib/business-module";
import type { BusinessCrmField, OrganizationSettings } from "@/lib/business-config";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

type CrmResponse = {
  leads: Lead[];
  kpis: {
    newToday: number;
    responseRate: number;
    avgCloseDays: number;
    pipelineValue: number;
    activeCustomers?: number;
    newLeads?: number;
    openTasks?: number;
    unattended?: number;
  };
  pipeline: Array<{ stage: string; count: number; value: number; conversionFromPrevious: number }>;
};

type CrmClient = {
  id: string;
  name: string;
  email?: string | null;
  whatsappNumber?: string | null;
};

type MessageTemplate = { id: string; name: string; channel: string; content: string; variables: string[] };

const CLIENT_ROW_PREFIX = "client:";

/** Map a Client into a Lead-shaped row so CRM search can show the same
 * customers the top global search finds (/api/clients). Opening navigates
 * to the client card — these rows are not editable Lead records. */
function clientToCrmRow(client: CrmClient): Lead {
  const now = new Date().toISOString();
  return {
    id: `${CLIENT_ROW_PREFIX}${client.id}`,
    name: client.name,
    company: null,
    phone: null,
    email: client.email ?? null,
    whatsapp: client.whatsappNumber ?? null,
    source: "manual",
    stage: "סגור",
    estimatedValue: 0,
    assignedTo: null,
    tags: [],
    notes: null,
    attachments: [],
    score: 0,
    priorityStars: 1,
    repliedAt: null,
    lastContactAt: null,
    nextReminderAt: null,
    lastMessageStatus: null,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
    timeline: [],
    sequences: [],
  };
}

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
  const searchParams = useSearchParams();
  const { t, dir, language } = useI18n();
  const locale = language === "he" ? "he-IL" : "en-US";

  const [data, setData] = useState<CrmResponse | null>(null);
  // Clients from /api/clients — same source the top global search uses for "לקוח".
  // Needed because CRM otherwise only searched Lead rows and missed customers like "שרית".
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [quickFilter, setQuickFilter] = useState<CrmQuickFilter>("all");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // "שמור ליד": באנר הצלחה ירוק (נעלם אחרי 2.5ש') ושגיאה אדומה — הכרטיס נשאר פתוח
  const [saveNotice, setSaveNotice] = useState("");
  const [saveError, setSaveError] = useState("");
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
    const [result, clientsResult] = await Promise.all([
      apiFetch<CrmResponse>(`/api/leads${params.toString() ? `?${params.toString()}` : ""}`),
      apiFetch<{ clients: CrmClient[] }>("/api/clients"),
    ]);
    setData(result);
    setClients(clientsResult.clients ?? []);
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

  // פתיחת כרטיס ליד מהחיפוש העליון: /crm?lead=<id> בוחר את הליד ופותח אותו.
  useEffect(() => {
    const leadId = searchParams.get("lead");
    if (!leadId || !data?.leads?.length) return;
    const match = data.leads.find((lead) => lead.id === leadId);
    if (match) setSelected(match);
    // מנקים את הפרמטר כדי שלא ייפתח שוב בכל רינדור
    router.replace("/crm");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, data?.leads]);

  const filteredLeads = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const leads = data?.leads ?? [];
    const searched = !query
      ? leads
      : leads.filter((lead) =>
          `${lead.name} ${lead.company ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.whatsapp ?? ""}`
            .toLowerCase()
            .includes(query)
        );

    // When searching: also include Client rows the top search would find, if no Lead
    // already covers the same name (avoids duplicates for people who exist in both models).
    if (query) {
      const leadNames = new Set(leads.map((lead) => lead.name.trim().toLowerCase()).filter(Boolean));
      const clientRows = clients
        .filter((client) =>
          `${client.name} ${client.email ?? ""} ${client.whatsappNumber ?? ""}`.toLowerCase().includes(query)
        )
        .filter((client) => !leadNames.has(client.name.trim().toLowerCase()))
        .map(clientToCrmRow);
      return applyQuickFilter([...searched, ...clientRows], quickFilter);
    }

    return applyQuickFilter(searched, quickFilter);
  }, [clients, data?.leads, filters.search, quickFilter]);

  const untreatedCount = useMemo(() => countUntreatedThisWeek(data?.leads ?? []), [data?.leads]);
  // Prefer authoritative DB KPI counts from /api/leads (same source as dashboard home-metrics).
  // Fall back to list-slice compute only if an older API omits the fields.
  const kpiValues = useMemo(() => {
    const fromApi = data?.kpis;
    if (
      fromApi &&
      typeof fromApi.activeCustomers === "number" &&
      typeof fromApi.newLeads === "number" &&
      typeof fromApi.openTasks === "number" &&
      typeof fromApi.unattended === "number"
    ) {
      return {
        activeCustomers: fromApi.activeCustomers,
        newLeads: fromApi.newLeads,
        openTasks: fromApi.openTasks,
        unattended: fromApi.unattended,
      };
    }
    return computeCrmKpis(data?.leads ?? []);
  }, [data?.kpis, data?.leads]);

  const businessModule = useMemo<BusinessModuleConfig>(
    () => getBusinessModule(organizationSettings?.businessType),
    [organizationSettings]
  );
  const crmLabels = useMemo(() => crmFieldMap(businessModule.crm.fields), [businessModule.crm.fields]);

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
      sendEmail: t("crmDesign.profile.sendEmail"),
      email: t("crmDesign.profile.email"),
      notProvided: t("crmDesign.profile.notProvided"),
      scheduleAppointment: t("crmDesign.profile.scheduleAppointment"),
      source: t("crmDesign.source"),
      whatsapp: t("crmDesign.whatsapp"),
      call: t("crmDesign.call"),
      assignedTo: t("crmDesign.profile.assignedTo"),
      nextAppointment: t("crmDesign.profile.nextAppointment"),
      upcomingAppointments: t("crmDesign.profile.upcomingAppointments"),
      pastAppointments: t("crmDesign.profile.pastAppointments"),
      appointmentsLoading: t("crmDesign.profile.appointmentsLoading"),
      appointmentsError: t("crmDesign.profile.appointmentsError"),
      noLinkedClient: t("crmDesign.profile.noLinkedClient"),
      service: t("crmDesign.profile.service"),
      employee: t("crmDesign.profile.employee"),
      owner: t("crmDesign.profile.owner"),
      noService: t("crmDesign.profile.noService"),
      duration: t("crmDesign.profile.duration"),
      minutes: t("crmDesign.profile.minutes"),
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
    if (saving) return; // מניעת שליחה כפולה — גם מהכפתור וגם מ-Enter
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      await apiFetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          estimatedValue: Number(form.estimatedValue || 0),
          tags: form.tags,
          whatsapp: form.phone,
          // רצף ההודעות מוסתר מהמסך כרגע (הפיצ'ר לא מוכן) — לא מפעילים אוטומטית.
          // ה-backend של הרצפים נשאר קיים; לידים מערוצים אחרים לא מושפעים.
          startSequence: false,
        }),
      });
      // הכרטיס נשאר פתוח והנתונים נשמרים בטופס; רק X סוגר. באנר ירוק ל-3ש'.
      setSaveNotice("הלקוח נשמר בהצלחה");
      window.setTimeout(() => setSaveNotice(""), 3000);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "שמירת הליד נכשלה — נסה שוב");
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
        pageTitle={<PageTitle title={businessModule.crm.pageTitle} subtitle={businessModule.crm.pageKicker} />}
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
            <Button
              variant="secondary"
              type="button"
              onClick={() => setShowImport(true)}
              data-testid="crm-import-clients"
            >
              <Upload className="h-4 w-4" />
              ייבוא לקוחות
            </Button>
            <Button variant="secondary" type="button" onClick={() => setTemplatesOpen((open) => !open)}>
              {t("crmDesign.templates")}
            </Button>
            <Button variant="secondary" type="button" onClick={scanGmailLeads} disabled={saving}>
              {t("crmDesign.scanGmail")}
            </Button>
            {/* „דברי עם נטלי": כפתור מוטמע בשורת הפעולות (לא צף) — בולט יותר:
                רקע כחול, טקסט לבן, גבול וצל עדין. נשאר בזרימת הפריסה, בלי חפיפה. */}
            <Button
              variant="primary"
              type="button"
              onClick={() => openNatalieAssistant(t("crmDesign.floatingNatalie"))}
              className="!border-[#1D4ED8] !bg-[#1D4ED8] !text-white shadow-[0_4px_14px_rgba(29,91,255,0.35)] hover:!bg-[#1746C7]"
              data-testid="crm-natalie-button"
            >
              {t("crmDesign.floatingNatalie")}
            </Button>
          </div>

          <ImportClientsDialog
            open={showImport}
            onClose={() => setShowImport(false)}
            onImported={async () => {
              setMessage("ייבוא הלקוחות הושלם");
              await load();
            }}
          />

          {/* חיפוש לידים לפי שם, טלפון או אימייל — מסנן את הרשימה בפועל. */}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--natalie-text-muted,#64748B)] end-3" />
            <Input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder={t("crmDesign.searchPlaceholder")}
              aria-label={t("crmDesign.searchPlaceholder")}
              className="pe-9"
              data-testid="crm-search-input"
            />
          </div>

          <CrmFilterChips value={quickFilter} onChange={setQuickFilter} labels={filterLabels} />

          {showForm ? (
            <Card>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">
                  {t("crmDesign.addCustomer")}
                </h2>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => setShowForm(false)}
                  aria-label={t("crmDesign.close")}
                  data-testid="lead-form-close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {saveNotice ? (
                <div data-testid="lead-save-notice">
                  <MessageBanner tone="success" className="mb-3">
                    {saveNotice}
                  </MessageBanner>
                </div>
              ) : null}
              {saveError ? (
                <div data-testid="lead-save-error">
                  <MessageBanner tone="error" className="mb-3">
                    {saveError}
                  </MessageBanner>
                </div>
              ) : null}
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
                <Button type="submit" disabled={saving} className="md:col-span-2" data-testid="save-lead-button">
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
                  onOpen={() => {
                    // Client-backed rows come from /api/clients (same as top search) —
                    // open the client card, not the Lead profile panel.
                    if (lead.id.startsWith(CLIENT_ROW_PREFIX)) {
                      router.push(`/dashboard/clients/${lead.id.slice(CLIENT_ROW_PREFIX.length)}`);
                      return;
                    }
                    // List payload omits timeline/sequences for speed; open immediately
                    // then hydrate full lead so profile tabs keep the same data.
                    setSelected(lead);
                    void apiFetch<Lead>(`/api/leads/${lead.id}`)
                      .then((full) => {
                        setSelected((current) => (current?.id === full.id ? full : current));
                      })
                      .catch(() => undefined);
                  }}
                />
              ))}
            </section>
          )}
        </div>

        <CrmProfilePanel
          lead={selected}
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          crmFields={businessModule.crm.fields}
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
