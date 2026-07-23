"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  Clock,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldAlert,
  Tag,
} from "lucide-react";
import { AppShell } from "@/components/natalie-ui";
import { apiFetch, ApiError } from "@/lib/api";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import { useLeadAdminSummary } from "@/hooks/useLeadAdminSummary";

type MarketingLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  businessType: string;
  note: string | null;
  planInterest: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPath: string | null;
  status: string;
  createdAt: string;
};

type LeadEvent = { id: string; type: string; detail: string | null; createdBy: string | null; createdAt: string };

const STATUS_LABELS: Record<string, string> = {
  new: "חדש",
  contacted: "נוצר קשר",
  qualified: "מתאים",
  converted: "הפך ללקוח",
  lost: "לא רלוונטי",
};

const STATUS_COLORS: Record<string, string> = {
  new: "#e02f44",
  contacted: "#b3552b",
  qualified: "#1d5bff",
  converted: "#1faa59",
  lost: "#8a94a6",
};

const PLAN_LABELS: Record<string, string> = {
  starter: "נטלי לעסק (149₪)",
  growth: "נטלי מנהלת את המשרד (199₪)",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const focusLeadId = searchParams.get("lead");
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [openLeadId, setOpenLeadId] = useState<string | null>(focusLeadId);
  const [events, setEvents] = useState<Record<string, LeadEvent[]>>({});
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const isPlatformAdmin = useIsPlatformAdmin();
  const { summary } = useLeadAdminSummary(isPlatformAdmin === true);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const query = status ? `?status=${status}` : "";
      const data = await apiFetch<{ leads: MarketingLead[] }>(`/api/admin/marketing-leads${query}`);
      setLeads(data.leads);
      setForbidden(false);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) setForbidden(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function openLead(id: string) {
    setOpenLeadId((current) => (current === id ? null : id));
    if (!events[id]) {
      const data = await apiFetch<{ lead: MarketingLead & { events: LeadEvent[] } }>(`/api/admin/marketing-leads/${id}`).catch(() => null);
      if (data) setEvents((current) => ({ ...current, [id]: data.lead.events }));
    }
  }

  async function updateStatus(id: string, status: string) {
    const data = await apiFetch<{ ok: boolean; lead: MarketingLead }>(`/api/admin/marketing-leads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => null);
    if (data?.ok) {
      setLeads((current) => current.map((lead) => (lead.id === id ? { ...lead, status } : lead)));
      setEvents((current) => ({ ...current, [id]: [] })); // ריענון היסטוריה בפתיחה הבאה
    }
  }

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const lead of leads) byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
    return byStatus;
  }, [leads]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg rounded-[22px] border border-[#e6eaf2] bg-white p-8 text-center shadow">
        <ShieldAlert className="mx-auto h-10 w-10 text-[#e02f44]" aria-hidden />
        <h1 className="mt-3 text-xl font-extrabold text-[#0f1830]">אין הרשאת גישה</h1>
        <p className="mt-2 text-sm font-medium text-[#6b7686]">
          העמוד זמין לאדמין הפלטפורמה בלבד (PLATFORM_ADMIN_EMAILS).
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-tight text-[#0f1830] md:text-[28px]">לידים שיווקיים</h1>
          {summary ? (
            <p className="mt-1 text-sm font-semibold text-[#6b7686]">
              היום: {summary.today} · השבוע: {summary.week} · החודש: {summary.month} · מתאימים: {summary.qualified} · לקוחות: {summary.converted}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load(filter)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#d7def0] bg-white px-4 py-2 text-sm font-bold text-[#1d5bff] transition hover:bg-[#eaf0ff]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          רענון
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="סינון לפי סטטוס">
        <FilterChip label={`הכל (${leads.length})`} active={filter === ""} onClick={() => setFilter("")} />
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <FilterChip
            key={value}
            label={`${label}${filter === "" && counts[value] ? ` (${counts[value]})` : ""}`}
            active={filter === value}
            onClick={() => setFilter(value)}
            color={STATUS_COLORS[value]}
          />
        ))}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm font-semibold text-[#6b7686]">טוען לידים...</p>
      ) : leads.length === 0 ? (
        <p className="py-10 text-center text-sm font-semibold text-[#6b7686]">אין לידים בסינון הזה.</p>
      ) : (
        <ul className="grid gap-3">
          {leads.map((lead) => (
            <li key={lead.id} className="rounded-[18px] border border-[#e6eaf2] bg-white shadow-[0_8px_28px_rgba(20,40,90,0.06)]">
              <button
                type="button"
                onClick={() => void openLead(lead.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 text-right"
                aria-expanded={openLeadId === lead.id}
              >
                <span
                  className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold text-white"
                  style={{ backgroundColor: STATUS_COLORS[lead.status] ?? "#8a94a6" }}
                >
                  {STATUS_LABELS[lead.status] ?? lead.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-extrabold text-[#0f1830]">{lead.name}</span>
                <span className="text-sm font-semibold text-[#6b7686]" dir="ltr">{lead.phone}</span>
                <span className="hidden text-sm font-semibold text-[#6b7686] sm:inline">{lead.businessType}</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8a94a6]">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {formatDate(lead.createdAt)}
                </span>
              </button>

              {openLeadId === lead.id ? (
                <div className="border-t border-[#e6eaf2] px-4 py-4">
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <Detail label="אימייל" value={lead.email} ltr />
                    <Detail label="חבילה" value={lead.planInterest ? PLAN_LABELS[lead.planInterest] ?? lead.planInterest : "לא נבחרה"} />
                    <Detail label="UTM Source" value={lead.source ?? "—"} ltr />
                    <Detail label="UTM Medium" value={lead.medium ?? "—"} ltr />
                    <Detail label="Campaign" value={lead.campaign ?? "—"} ltr />
                    <Detail label="עמוד נחיתה (כולל referral)" value={lead.landingPath ?? "—"} ltr />
                    {lead.note ? <Detail label="הערה" value={lead.note} /> : null}
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <a href={`tel:${lead.phone}`} className="quick-action inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#1d5bff] px-4 text-sm font-bold text-white transition hover:bg-[#1648cc]">
                      <Phone className="h-4 w-4" aria-hidden /> התקשר
                    </a>
                    <a
                      href={`https://wa.me/${lead.phone.replace(/^0/, "972").replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[#1faa59] px-4 text-sm font-bold text-white transition hover:brightness-95"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
                    </a>
                    <a href={`mailto:${lead.email}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[#d7def0] bg-white px-4 text-sm font-bold text-[#0f1830] transition hover:bg-[#f4f6fb]">
                      <Mail className="h-4 w-4" aria-hidden /> אימייל
                    </a>
                    <label className="inline-flex items-center gap-2 text-sm font-bold text-[#6b7686]">
                      <Tag className="h-4 w-4" aria-hidden />
                      סטטוס:
                      <select
                        value={lead.status}
                        onChange={(event) => void updateStatus(lead.id, event.target.value)}
                        className="min-h-10 rounded-full border border-[#d7def0] bg-white px-3 text-sm font-bold text-[#0f1830]"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {events[lead.id]?.length ? (
                    <div className="mt-4 border-t border-[#f0f2f8] pt-3">
                      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#8a94a6]">היסטוריה</p>
                      <ul className="grid gap-1.5 text-xs font-semibold text-[#6b7686]">
                        {events[lead.id].map((event) => (
                          <li key={event.id}>
                            {formatDate(event.createdAt)} · {event.type === "status_change" ? `סטטוס → ${STATUS_LABELS[event.detail ?? ""] ?? event.detail}` : event.type}
                            {event.createdBy ? ` · ${event.createdBy}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-10 rounded-full border px-4 text-sm font-bold transition ${
        active ? "border-transparent text-white" : "border-[#d7def0] bg-white text-[#6b7686] hover:bg-[#f4f6fb]"
      }`}
      style={active ? { backgroundColor: color ?? "#1d5bff" } : undefined}
    >
      {label}
    </button>
  );
}

function Detail({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-[12px] bg-[#f4f6fb] px-3 py-2">
      <dt className="text-xs font-bold text-[#8a94a6]">{label}</dt>
      <dd className="mt-0.5 break-all font-semibold text-[#0f1830]" dir={ltr ? "ltr" : undefined} style={{ textAlign: "right" }}>
        {value}
      </dd>
    </div>
  );
}

export default function AdminLeadsPage() {
  return (
    <div dir="rtl">
      <AppShell>
        <Suspense fallback={null}>
          <LeadsPageInner />
        </Suspense>
      </AppShell>
    </div>
  );
}
