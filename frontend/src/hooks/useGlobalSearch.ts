"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { filterClientsByQuery } from "@/lib/clients/clientSearch";
import { formatAmount } from "@/lib/format/amount";

type SearchClient = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
};
type SearchLead = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
};
type SearchInvoice = {
  id: string;
  invoiceNumber: string | null;
  description: string | null;
  amount: number;
  currency: string;
  client?: { name: string } | null;
};
type SearchTask = { id: string; title: string; supplier: string | null; status: string };

export type GlobalSearchResult = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  href: string;
};

export function useGlobalSearch() {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchData, setSearchData] = useState<{
    clients: SearchClient[];
    leads: SearchLead[];
    invoices: SearchInvoice[];
    tasks: SearchTask[];
  }>({ clients: [], leads: [], invoices: [], tasks: [] });

  const loadSearchData = useCallback(async () => {
    if (searchLoaded || searchLoading) return;
    setSearchLoading(true);
    setSearchError("");
    try {
      const [clientsResult, leadsResult, invoicesResult, tasksResult] = await Promise.allSettled([
        apiFetch<{ clients: SearchClient[] }>("/api/clients"),
        // לידים של ה-CRM חיים במודל Lead (לא Client) — בלי זה חיפוש עליון
        // של "אלכס" (ליד) לא מחזיר כלום למרות שהוא קיים ברשימת ה-CRM.
        apiFetch<{ leads: SearchLead[] }>("/api/leads"),
        apiFetch<{ invoices: SearchInvoice[] }>("/api/invoices"),
        apiFetch<SearchTask[]>("/api/tasks"),
      ]);

      setSearchData({
        clients: clientsResult.status === "fulfilled" ? clientsResult.value.clients ?? [] : [],
        leads: leadsResult.status === "fulfilled" ? leadsResult.value.leads ?? [] : [],
        invoices: invoicesResult.status === "fulfilled" ? invoicesResult.value.invoices ?? [] : [],
        tasks: tasksResult.status === "fulfilled" ? tasksResult.value ?? [] : [],
      });
      setSearchLoaded(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "החיפוש נכשל");
    } finally {
      setSearchLoading(false);
    }
  }, [searchLoaded, searchLoading]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        void loadSearchData();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [loadSearchData]);

  const searchResults = useMemo<GlobalSearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) return [];

    // אותה לוגיקת סינון כמו במסך הלקוחות — מקור אחד: clientSearch. חיפוש
    // "שרית" (או טלפון/אימייל שלה) מחזיר את אותה לקוחה בשני המקומות.
    const clients = filterClientsByQuery(searchData.clients, query)
      .slice(0, 4)
      .map((client) => ({
        id: `client-${client.id}`,
        type: "לקוח",
        title: client.name,
        subtitle: client.email ?? "לקוח",
        href: `/dashboard/clients/${client.id}`,
      }));

    // חיפוש לידים לפי שם, טלפון ואימייל; פתיחת הכרטיס דרך /crm?lead=<id>
    const leads = searchData.leads
      .filter((lead) =>
        `${lead.name} ${lead.email ?? ""} ${lead.phone ?? ""} ${lead.whatsapp ?? ""}`.toLowerCase().includes(query)
      )
      .slice(0, 4)
      .map((lead) => ({
        id: `lead-${lead.id}`,
        type: "ליד",
        title: lead.name,
        subtitle: lead.phone ?? lead.email ?? "ליד",
        href: `/crm?lead=${encodeURIComponent(lead.id)}`,
      }));

    const invoices = searchData.invoices
      .filter((invoice) =>
        `${invoice.invoiceNumber ?? ""} ${invoice.description ?? ""} ${invoice.client?.name ?? ""}`.toLowerCase().includes(query)
      )
      .slice(0, 4)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        type: "חשבונית",
        title: invoice.invoiceNumber || invoice.client?.name || "חשבונית",
        subtitle: `${invoice.client?.name ?? "ללא לקוח"} · ${formatAmount(invoice.amount, invoice.currency, "סכום חסר")}`,
        href: "/dashboard/invoices",
      }));

    const tasks = searchData.tasks
      .filter((task) => `${task.title} ${task.supplier ?? ""} ${task.status}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((task) => ({
        id: `task-${task.id}`,
        type: "משימה",
        title: task.title,
        subtitle: task.supplier ?? task.status,
        href: "/tasks",
      }));

    return [...clients, ...leads, ...invoices, ...tasks];
  }, [searchData, searchQuery]);

  function openSearchResult(href: string) {
    setSearchOpen(false);
    setSearchQuery("");
    router.push(href);
  }

  return {
    searchInputRef,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchLoading,
    searchError,
    searchResults,
    loadSearchData,
    openSearchResult,
  };
}
