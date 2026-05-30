"use client";

import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { apiFetch } from "@/lib/api";
import { getBusinessProfile, type BusinessCrmField, type OrganizationSettings } from "@/lib/business-config";
import { BarChart3, CalendarClock, Flame, GripVertical, List, MessageCircle, Plus, Search, Star, UserRoundCheck } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  source: string;
  stage: string;
  estimatedValue: number;
  assignedTo: string | null;
  tags: string[];
  notes: string | null;
  attachments: string[];
  score: number;
  priorityStars: number;
  repliedAt: string | null;
  lastContactAt: string | null;
  nextReminderAt: string | null;
  lastMessageStatus: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ id: string; type: string; content: string; channel: string | null; createdAt: string }>;
  sequences: Array<{ id: string; step: number; channel: string; template: string; scheduledAt: string; sentAt: string | null; status: string }>;
};

type CrmResponse = {
  leads: Lead[];
  kpis: { newToday: number; responseRate: number; avgCloseDays: number; pipelineValue: number };
  pipeline: Array<{ stage: string; count: number; value: number; conversionFromPrevious: number }>;
};

type ViewMode = "kanban" | "list" | "pipeline";
type MessageTemplate = { id: string; name: string; channel: string; content: string; variables: string[] };

const stages = ["חדש", "יצירת קשר", "בטיפול", "הצעת מחיר", "סגור", "הפסד"];
const sources = ["manual", "whatsapp", "email", "website", "referral", "facebook"];
const stageTone: Record<string, string> = {
  חדש: "border-blue-400/30 bg-blue-400/10 text-blue-100",
  "יצירת קשר": "border-violet-400/30 bg-violet-400/10 text-violet-100",
  בטיפול: "border-orange-400/30 bg-orange-400/10 text-orange-100",
  "הצעת מחיר": "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  סגור: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  הפסד: "border-red-400/30 bg-red-400/10 text-red-100",
};

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
  const [data, setData] = useState<CrmResponse | null>(null);
  const [view, setView] = useState<ViewMode>("kanban");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState("");
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
    load().catch((err) => setMessage(err instanceof Error ? err.message : "טעינת CRM נכשלה"));
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
    if (!query) return leads;
    return leads.filter((lead) => `${lead.name} ${lead.company ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""}`.toLowerCase().includes(query));
  }, [data?.leads, filters.search]);

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
      setMessage("הליד נוסף וה-sequence הופעל אוטומטית");
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
    setMessage("הליד סומן כענה וה-sequence נעצר");
    await load();
  }

  async function dropLead(stage: string) {
    if (!draggedId) return;
    setDraggedId("");
    try {
      await updateLead(draggedId, { stage });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "עדכון שלב נכשל");
    }
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
      setMessage(err instanceof Error ? err.message : "סריקת לידים מ-Gmail נכשלה");
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(id: string, content: string) {
    const updated = await apiFetch<MessageTemplate>(`/api/leads/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    setTemplates((current) => current.map((template) => template.id === id ? updated : template));
    setMessage("תבנית ההודעה נשמרה");
  }

  const kpis = data?.kpis ?? { newToday: 0, responseRate: 0, avgCloseDays: 0, pipelineValue: 0 };
  const businessProfile = organizationSettings?.businessProfile ?? getBusinessProfile(organizationSettings?.businessType);
  const crmLabels = crmFieldMap(businessProfile.crmFields);

  return (
    <div className="container">
      <Nav />
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="page-kicker">CRM automation</div>
          <h1>{businessProfile.title}</h1>
          <p>{businessProfile.subtitle}</p>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <button className="btn" onClick={() => setShowForm((open) => !open)}><Plus className="h-4 w-4" />הוסף ליד</button>
          <button className="btn btn-secondary" onClick={() => setTemplatesOpen((open) => !open)}>תבניות sequence</button>
          <button className="btn btn-secondary" onClick={scanGmailLeads} disabled={saving}>סרוק לידים מ-Gmail</button>
        </div>
      </div>

      {message && <div className="mb-6 rounded-2xl border border-accent-primary/30 bg-accent-primary/10 p-4 text-base text-ink-primary">{message}</div>}

      <section className="grid mb-6">
        <KpiCard label={crmKpiLabel(organizationSettings?.businessType, "newToday")} value={kpis.newToday} icon={<UserRoundCheck className="h-5 w-5" />} />
        <KpiCard label={crmKpiLabel(organizationSettings?.businessType, "responseRate")} value={`${kpis.responseRate}%`} icon={<MessageCircle className="h-5 w-5" />} />
        <KpiCard label={crmKpiLabel(organizationSettings?.businessType, "avgCloseDays")} value={`${kpis.avgCloseDays} ימים`} icon={<CalendarClock className="h-5 w-5" />} />
        <KpiCard label="ערך Pipeline" value={`₪${kpis.pipelineValue.toLocaleString("he-IL")}`} icon={<Flame className="h-5 w-5" />} />
      </section>

      <section className="card mb-6">
        <div className="mb-3">
          <h2>שדות CRM מותאמים</h2>
          <p className="text-sm">הטופס משתמש באותם נתוני CRM קיימים, עם שפה ושדות עבודה שמותאמים לסוג העסק.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {businessProfile.crmFields.map((field) => (
            <div key={field.key} className="rounded-xl border border-[var(--border-subtle)] bg-surface-secondary p-3">
              <strong className="block text-ink-primary">{field.label}</strong>
              <span className="text-sm text-ink-secondary">{field.placeholder}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 md:grid-cols-4">
            <label>
              חיפוש
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-ink-muted" />
                <input className="pr-10" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="שם, חברה, טלפון או מייל" />
              </div>
            </label>
            <label>
              מקור
              <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>
                <option value="all">כל המקורות</option>
                {sources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </label>
            <label>
              שלב
              <select value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value })}>
                <option value="all">כל השלבים</option>
                {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
            </label>
            <label>
              ערך מינימלי
              <input type="number" value={filters.minValue} onChange={(event) => setFilters({ ...filters, minValue: event.target.value })} placeholder="0" />
            </label>
            <label>
              ערך מקסימלי
              <input type="number" value={filters.maxValue} onChange={(event) => setFilters({ ...filters, maxValue: event.target.value })} placeholder="ללא הגבלה" />
            </label>
            <label>
              מתאריך
              <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
            </label>
            <label>
              עד תאריך
              <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
            </label>
            <label>
              סוכן אחראי
              <input value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value })} placeholder="User ID או שם" />
            </label>
            <label>
              מיון
              <select value={filters.sortBy} onChange={(event) => setFilters({ ...filters, sortBy: event.target.value })}>
                <option value="updatedAt">עודכן לאחרונה</option>
                <option value="createdAt">תאריך כניסה</option>
                <option value="estimatedValue">ערך עסקה</option>
                <option value="score">ציון</option>
                <option value="stage">שלב</option>
                <option value="source">מקור</option>
                <option value="name">שם</option>
              </select>
            </label>
            <label>
              כיוון
              <select value={filters.sortDir} onChange={(event) => setFilters({ ...filters, sortDir: event.target.value })}>
                <option value="desc">מהגבוה לנמוך</option>
                <option value="asc">מהנמוך לגבוה</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-toggle-inactive self-end"
              onClick={() => setFilters({ search: "", source: "all", stage: "all", minValue: "", maxValue: "", assignedTo: "", from: "", to: "", sortBy: "updatedAt", sortDir: "desc" })}
            >
              נקה פילטרים
            </button>
          </div>
          <div className="grid gap-2 sm:flex">
            <ViewButton active={view === "kanban"} onClick={() => setView("kanban")} icon={<GripVertical className="h-4 w-4" />}>Kanban</ViewButton>
            <ViewButton active={view === "list"} onClick={() => setView("list")} icon={<List className="h-4 w-4" />}>רשימה</ViewButton>
            <ViewButton active={view === "pipeline"} onClick={() => setView("pipeline")} icon={<BarChart3 className="h-4 w-4" />}>Pipeline</ViewButton>
          </div>
        </div>
      </section>

      {showForm && (
        <form onSubmit={createLead} className="card grid gap-3 md:grid-cols-3">
          <label>{crmLabels.name.label}<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={crmLabels.name.placeholder} /></label>
          <label>{crmLabels.phone.label}<input required dir="ltr" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder={crmLabels.phone.placeholder} /></label>
          <label>מקור<select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
          <label>{crmLabels.company.label}<input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder={crmLabels.company.placeholder} /></label>
          <label>{crmLabels.email.label}<input dir="ltr" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder={crmLabels.email.placeholder} /></label>
          <label>{crmLabels.estimatedValue.label}<input type="number" value={form.estimatedValue} onChange={(event) => setForm({ ...form, estimatedValue: event.target.value })} placeholder={crmLabels.estimatedValue.placeholder} /></label>
          <label className="md:col-span-2">{crmLabels.tags.label}<input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder={crmLabels.tags.placeholder} /></label>
          <label>{crmLabels.notes.label}<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder={crmLabels.notes.placeholder} /></label>
          <button className="btn md:col-span-3" disabled={saving}>{saving ? "שומר..." : "שמור והפעל sequence"}</button>
        </form>
      )}

      {templatesOpen && <TemplatePanel templates={templates} onSave={saveTemplate} />}

      {!data ? <div className="card"><p>טוען CRM...</p></div> : null}
      {data && view === "kanban" && (
        <section className="grid gap-4 xl:grid-cols-6">
          {stages.map((stage) => {
            const leads = filteredLeads.filter((lead) => lead.stage === stage);
            return (
              <div key={stage} className={`rounded-2xl border p-3 ${stageTone[stage] ?? "border-[var(--border)] bg-surface-card"}`} onDragOver={(event) => event.preventDefault()} onDrop={() => dropLead(stage)}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <strong>{stage}</strong>
                  <span className="badge badge-ok">{leads.length}</span>
                </div>
                <div className="grid gap-3">
                  {leads.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onOpen={() => setSelected(lead)} onDrag={() => setDraggedId(lead.id)} onStage={(next) => updateLead(lead.id, { stage: next })} />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {data && view === "list" && (
        <section className="table-shell">
          <table>
            <thead><tr><th>שם</th><th>טלפון</th><th>מקור</th><th>שלב</th><th>ערך</th><th>ציון</th><th>סוכן</th><th>תאריך</th><th>תזכורת</th></tr></thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="cursor-pointer" onClick={() => setSelected(lead)}>
                  <td>{lead.name}<br /><span className="text-ink-muted">{lead.company}</span></td>
                  <td>{lead.phone ?? "-"}</td>
                  <td>{lead.source}</td>
                  <td>{lead.stage}</td>
                  <td>₪{lead.estimatedValue.toLocaleString("he-IL")}</td>
                  <td><ScoreBadge score={lead.score} /></td>
                  <td>{lead.assignedTo || "-"}</td>
                  <td>{new Date(lead.createdAt).toLocaleDateString("he-IL")}</td>
                  <td>{lead.nextReminderAt ? new Date(lead.nextReminderAt).toLocaleDateString("he-IL") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data && view === "pipeline" && <PipelineView rows={data.pipeline} />}
      {selected && (
        <LeadModal
          lead={selected}
          timelineText={timelineText}
          setTimelineText={setTimelineText}
          onClose={() => setSelected(null)}
          onUpdate={updateLead}
          onMarkReply={markLeadReply}
          onAddTimeline={addTimeline}
          crmFields={businessProfile.crmFields}
        />
      )}
    </div>
  );
}

function LeadCard({ lead, onOpen, onDrag, onStage }: { lead: Lead; onOpen: () => void; onDrag: () => void; onStage: (stage: string) => void }) {
  const stale = !lead.lastContactAt || Date.now() - new Date(lead.lastContactAt).getTime() > 48 * 60 * 60 * 1000;
  return (
    <button draggable onDragStart={onDrag} onClick={onOpen} className={`group w-full rounded-2xl border p-4 text-right transition hover:-translate-y-0.5 ${stale ? "border-red-400/50 bg-red-500/10" : "border-[var(--border)] bg-surface-card"}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-ink-primary">{lead.name}</strong>
          <span className="block truncate text-sm text-ink-secondary">{lead.company || lead.phone || lead.email}</span>
        </div>
        <GripVertical className="h-4 w-4 shrink-0 text-ink-muted" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <ScoreBadge score={lead.score} />
        <span className="badge badge-warn">{lead.source}</span>
      </div>
      <div className="grid gap-1 text-sm text-ink-secondary">
        <span>₪{lead.estimatedValue.toLocaleString("he-IL")}</span>
        <span>{daysSince(lead.createdAt)} ימים מאז הגיע</span>
        <span>{lead.lastMessageStatus || "אין הודעה אחרונה"}</span>
      </div>
      <div className="mt-3 flex gap-2 sm:hidden">
        {stages.map((stage) => <span key={stage} onClick={(event) => { event.stopPropagation(); onStage(stage); }} className="h-2 flex-1 rounded-full bg-accent-primary/40" />)}
      </div>
    </button>
  );
}

function crmFieldMap(fields: BusinessCrmField[]) {
  const fallback: Record<BusinessCrmField["key"], BusinessCrmField> = {
    name: { key: "name", label: "שם", placeholder: "שם מלא" },
    company: { key: "company", label: "חברה", placeholder: "שם חברה או הקשר" },
    phone: { key: "phone", label: "טלפון", placeholder: "+972..." },
    email: { key: "email", label: "מייל", placeholder: "client@example.com" },
    estimatedValue: { key: "estimatedValue", label: "ערך עסקה", placeholder: "0" },
    tags: { key: "tags", label: "תגיות", placeholder: "דחוף, המלצה, VIP" },
    notes: { key: "notes", label: "הערות", placeholder: "הערות פנימיות" },
  };
  return fields.reduce((acc, field) => ({ ...acc, [field.key]: field }), fallback);
}

type CrmKpiKey = "newToday" | "responseRate" | "avgCloseDays";

function crmKpiLabel(businessType: string | null | undefined, key: CrmKpiKey) {
  const labels: Record<string, Record<CrmKpiKey, string>> = {
    beauty_clinic: { newToday: "מתעניינות חדשות", responseRate: "שיעור מענה", avgCloseDays: "זמן לסגירת טיפול" },
    accountant: { newToday: "פניות לקוחות", responseRate: "שיעור מענה", avgCloseDays: "זמן סגירת חוסר" },
    lawyer: { newToday: "פניות לתיקים", responseRate: "שיעור מענה", avgCloseDays: "זמן לסגירת תיק" },
    insurance_agency: { newToday: "לידים לפוליסה", responseRate: "שיעור מענה", avgCloseDays: "זמן לסגירת פוליסה" },
    real_estate: { newToday: "קונים/מוכרים חדשים", responseRate: "שיעור מענה", avgCloseDays: "זמן לעסקה" },
    ecommerce: { newToday: "פניות לקוחות", responseRate: "שיעור מענה", avgCloseDays: "זמן טיפול" },
    importer: { newToday: "פניות מסחריות", responseRate: "שיעור מענה", avgCloseDays: "זמן סגירת הזמנה" },
    marketing_agency: { newToday: "לידים לקמפיין", responseRate: "שיעור מענה", avgCloseDays: "זמן לסגירת ריטיינר" },
    restaurant: { newToday: "פניות / אירועים", responseRate: "שיעור מענה", avgCloseDays: "זמן סגירת הזמנה" },
  };
  const fallback = { newToday: "לידים חדשים היום", responseRate: "שיעור תשובה", avgCloseDays: "ממוצע לסגירה" };
  return (businessType && labels[businessType]?.[key]) || fallback[key];
}

function LeadModal({
  lead,
  timelineText,
  setTimelineText,
  onClose,
  onUpdate,
  onMarkReply,
  onAddTimeline,
  crmFields,
}: {
  lead: Lead;
  timelineText: string;
  setTimelineText: (value: string) => void;
  onClose: () => void;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onMarkReply: (lead: Lead, replyMessage: string) => Promise<void>;
  onAddTimeline: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  crmFields: BusinessCrmField[];
}) {
  const crmLabels = crmFieldMap(crmFields);
  const [draft, setDraft] = useState({
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
  const [replyText, setReplyText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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
  }, [lead]);

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onUpdate(lead.id, {
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
      await onMarkReply(lead, replyText);
      setReplyText("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-end bg-black/70 p-4 backdrop-blur-sm sm:place-items-center">
      <div className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="page-kicker">כרטיס ליד</div>
            <h2>{lead.name}</h2>
            <p>{lead.company || "ללא חברה"} · {lead.phone || "ללא טלפון"} · {lead.email || "ללא מייל"}</p>
          </div>
          <button className="btn btn-secondary !w-auto" onClick={onClose}>סגור</button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Info label="מקור" value={lead.source} />
          <Info label="שלב" value={lead.stage} />
          <Info label={crmLabels.estimatedValue.label} value={`₪${lead.estimatedValue.toLocaleString("he-IL")}`} />
          <Info label="ציון" value={`${lead.score} · ${"★".repeat(lead.priorityStars)}`} />
          <Info label="סוכן אחראי" value={lead.assignedTo || "לא הוגדר"} />
          <Info label="תזכורת הבאה" value={lead.nextReminderAt ? new Date(lead.nextReminderAt).toLocaleString("he-IL") : "אין"} />
        </div>
        <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
          {stages.map((stage) => <button key={stage} className={lead.stage === stage ? "btn" : "btn btn-toggle-inactive"} onClick={() => onUpdate(lead.id, { stage })}>{stage}</button>)}
        </div>
        <form onSubmit={saveDetails} className="mt-6 grid gap-3 md:grid-cols-3">
          <label>{crmLabels.name.label}<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={crmLabels.name.placeholder} /></label>
          <label>{crmLabels.company.label}<input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} placeholder={crmLabels.company.placeholder} /></label>
          <label>מקור<select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
          <label>{crmLabels.phone.label}<input dir="ltr" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder={crmLabels.phone.placeholder} /></label>
          <label>וואטסאפ<input dir="ltr" value={draft.whatsapp} onChange={(event) => setDraft({ ...draft, whatsapp: event.target.value })} /></label>
          <label>{crmLabels.email.label}<input dir="ltr" type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder={crmLabels.email.placeholder} /></label>
          <label>{crmLabels.estimatedValue.label}<input type="number" value={draft.estimatedValue} onChange={(event) => setDraft({ ...draft, estimatedValue: event.target.value })} placeholder={crmLabels.estimatedValue.placeholder} /></label>
          <label>סוכן אחראי<input value={draft.assignedTo} onChange={(event) => setDraft({ ...draft, assignedTo: event.target.value })} /></label>
          <label>תזכורת הבאה<input type="datetime-local" value={draft.nextReminderAt} onChange={(event) => setDraft({ ...draft, nextReminderAt: event.target.value })} /></label>
          <label className="md:col-span-2">{crmLabels.tags.label}<input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder={crmLabels.tags.placeholder} /></label>
          <label>קבצים מצורפים<input value={draft.attachments} onChange={(event) => setDraft({ ...draft, attachments: event.target.value })} placeholder="URL, URL" /></label>
          <label className="md:col-span-3">{crmLabels.notes.label}<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder={crmLabels.notes.placeholder} /></label>
          <button className="btn md:col-span-3" disabled={saving}>{saving ? "שומר..." : "שמור פרטי ליד"}</button>
        </form>
        <section className="mt-6 grid gap-4 md:grid-cols-[1fr_.9fr]">
          <div>
            <h3 className="mb-3 text-lg font-semibold text-ink-primary">ציר זמן</h3>
            <div className="grid gap-3">
              {lead.timeline.map((item) => (
                <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-3">
                  <strong>{item.type}</strong>
                  <p>{item.content}</p>
                  <small className="text-ink-muted">{new Date(item.createdAt).toLocaleString("he-IL")}</small>
                </div>
              ))}
              {lead.timeline.length === 0 && <p>אין אירועים עדיין.</p>}
            </div>
            <form onSubmit={onAddTimeline} className="mt-4 grid gap-2">
              <textarea value={timelineText} onChange={(event) => setTimelineText(event.target.value)} placeholder="הוסף הערה פנימית" />
              <button className="btn">הוסף לציר הזמן</button>
            </form>
          </div>
          <div>
            <h3 className="mb-3 text-lg font-semibold text-ink-primary">Sequence</h3>
            <div className="mb-4 rounded-2xl border border-[var(--border)] bg-surface-secondary p-3">
              <label>
                סמן שהליד ענה
                <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="תוכן התשובה שהתקבלה" />
              </label>
              <button className="btn mt-2" onClick={markReply} disabled={saving || (!lead.phone && !lead.whatsapp && !lead.email)}>
                עצור sequence וסמן תשובה
              </button>
            </div>
            <div className="grid gap-2">
              {lead.sequences.map((sequence) => (
                <div key={sequence.id} className="rounded-2xl bg-surface-secondary p-3">
                  <strong>{sequence.template}</strong>
                  <p>{sequence.channel} · {sequence.status}</p>
                  <small>{new Date(sequence.scheduledAt).toLocaleString("he-IL")}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PipelineView({ rows }: { rows: CrmResponse["pipeline"] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="card">
      <h2>Pipeline מכירות</h2>
      <div className="mt-5 grid gap-4">
        {rows.map((row) => (
          <div key={row.stage} className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <strong>{row.stage}</strong>
              <span>{row.count} לידים · ₪{row.value.toLocaleString("he-IL")} · {row.conversionFromPrevious}% המרה</span>
            </div>
            <div className="h-4 overflow-hidden rounded-full bg-surface-secondary">
              <div className="h-full rounded-full bg-[#6366F1]" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
    <section className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2>תבניות sequence</h2>
          <p>עריכת התבניות תשפיע על הודעות אוטומטיות עתידיות ללידים.</p>
        </div>
        <span className="badge badge-ok">{templates.length}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <div key={template.id} className="rounded-2xl border border-[var(--border)] bg-surface-secondary p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <strong>{template.name}</strong>
              <span className="badge badge-warn">{template.channel}</span>
            </div>
            <textarea
              className="min-h-44"
              value={drafts[template.id] ?? template.content}
              onChange={(event) => setDrafts((current) => ({ ...current, [template.id]: event.target.value }))}
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <small className="text-ink-muted">משתנים: {template.variables.join(", ") || "אין"}</small>
              <button className="btn !w-auto" onClick={() => save(template)} disabled={savingId === template.id}>
                {savingId === template.id ? "שומר..." : "שמור תבנית"}
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 && <p>אין תבניות להצגה.</p>}
      </div>
    </section>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-hover text-accent-primary">{icon}</span>
      </div>
    </div>
  );
}

function ViewButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={active ? "btn" : "btn btn-toggle-inactive"} onClick={onClick}>{icon}{children}</button>;
}

function ScoreBadge({ score }: { score: number }) {
  const className = score <= 40 ? "badge-error" : score <= 70 ? "badge-warn" : "badge-ok";
  const label = score <= 40 ? "קר" : score <= 70 ? "פושר" : "חם";
  return <span className={`badge ${className}`}><Star className="h-3.5 w-3.5" />{score} · {label}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-surface-secondary p-3"><div className="text-sm text-ink-muted">{label}</div><strong>{value}</strong></div>;
}

function daysSince(date: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
