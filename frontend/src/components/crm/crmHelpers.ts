import { uiTranslations } from "@/lib/business-config";
import type { CrmQuickFilter, Lead } from "./types";

export const crmStages = ["חדש", "יצירת קשר", "בטיפול", "הצעת מחיר", "סגור", "הפסד"] as const;
export const crmSources = ["manual", "whatsapp", "email", "website", "referral", "facebook"] as const;

const staleMs = 48 * 60 * 60 * 1000;

export function sourceLabel(source: string) {
  return uiTranslations.crmSources[source as keyof typeof uiTranslations.crmSources] ?? source;
}

export function channelLabel(channel: string | null | undefined) {
  if (!channel) return "";
  return uiTranslations.sequenceChannels[channel as keyof typeof uiTranslations.sequenceChannels] ?? channel;
}

export function statusLabel(status: string | null | undefined) {
  if (!status) return "";
  return uiTranslations.statuses[status as keyof typeof uiTranslations.statuses] ?? status;
}

export function timelineTypeLabel(type: string) {
  const labels: Record<string, string> = {
    note: "הערה",
    message: "הודעה",
    reply: "תשובה",
    stage: "שינוי שלב",
    created: "נוצר",
  };
  return labels[type] ?? type;
}

export function isStaleLead(lead: Lead) {
  return !lead.lastContactAt || Date.now() - new Date(lead.lastContactAt).getTime() > staleMs;
}

export function countUntreatedThisWeek(leads: Lead[]) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return leads.filter(
    (lead) =>
      ["חדש", "יצירת קשר"].includes(lead.stage) &&
      !lead.repliedAt &&
      new Date(lead.createdAt).getTime() >= weekAgo
  ).length;
}

export function applyQuickFilter(leads: Lead[], filter: CrmQuickFilter) {
  switch (filter) {
    case "leads":
      return leads.filter((lead) => ["חדש", "יצירת קשר"].includes(lead.stage));
    case "customers":
      return leads.filter((lead) => ["בטיפול", "הצעת מחיר", "סגור"].includes(lead.stage));
    case "pending":
      return leads.filter((lead) => lead.stage === "בטיפול" && !lead.repliedAt);
    case "followup":
      return leads.filter(
        (lead) =>
          isStaleLead(lead) ||
          Boolean(lead.nextReminderAt && new Date(lead.nextReminderAt).getTime() <= Date.now())
      );
    default:
      return leads;
  }
}

export function computeCrmKpis(leads: Lead[]) {
  return {
    activeCustomers: leads.filter((lead) => !["הפסד", "סגור"].includes(lead.stage)).length,
    newLeads: leads.filter((lead) => lead.stage === "חדש").length,
    openTasks: leads.filter((lead) => Boolean(lead.nextReminderAt)).length,
    unattended: leads.filter((lead) => isStaleLead(lead)).length,
  };
}

export function stageTone(stage: string): "info" | "warn" | "success" | "danger" | "neutral" {
  if (stage === "חדש" || stage === "יצירת קשר") return "info";
  if (stage === "בטיפול" || stage === "הצעת מחיר") return "warn";
  if (stage === "סגור") return "success";
  if (stage === "הפסד") return "danger";
  return "neutral";
}

export function formatInteractionDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function formatTaskDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function whatsappHref(lead: Lead) {
  const phone = (lead.whatsapp || lead.phone || "").replace(/\D/g, "");
  return phone ? `https://wa.me/${phone}` : undefined;
}

export function callHref(lead: Lead) {
  const phone = lead.phone || lead.whatsapp;
  return phone ? `tel:${phone}` : undefined;
}

export function emailHref(lead: Lead) {
  const email = lead.email?.trim();
  return email ? `mailto:${email}` : undefined;
}

export function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
