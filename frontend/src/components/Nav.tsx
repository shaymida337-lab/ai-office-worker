"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { apiFetch } from "@/lib/api";
import type { BusinessModuleId, OrganizationSettings } from "@/lib/business-config";
import {
  BarChart3,
  Bell,
  Camera,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  CircleDollarSign,
  FileBarChart,
  FileText,
  Home,
  Landmark,
  Menu,
  Megaphone,
  MessageCircle,
  Search,
  Settings,
  Users,
  WalletCards,
  X,
} from "lucide-react";

const links: Array<{ href: string; label: string; icon: typeof Home; module?: BusinessModuleId | "admin" }> = [
  { href: "/dashboard", label: "לוח בקרה", icon: Home },
  { href: "/crm", label: "CRM", icon: CircleDollarSign, module: "crm" },
  { href: "/message-scans", label: "סריקות הודעות", icon: Search },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users, module: "crm" },
  { href: "/dashboard/invoices", label: "חשבוניות", icon: FileText, module: "invoices" },
  { href: "/payments", label: "תשלומי ספקים", icon: WalletCards, module: "supplier_management" },
  { href: "/dashboard/bank", label: "התאמת בנק", icon: Landmark, module: "supplier_management" },
  { href: "/collections", label: "גבייה", icon: CircleDollarSign, module: "collections" },
  { href: "/tasks", label: "משימות", icon: CheckSquare, module: "tasks" },
  { href: "/social", label: "סושיאל", icon: Megaphone },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle, module: "whatsapp" },
  { href: "/reports", label: "דוחות", icon: BarChart3 },
  { href: "/dashboard/accountant", label: "רואה חשבון", icon: FileBarChart },
  { href: "/camera", label: "צילום חשבונית", icon: Camera, module: "documents" },
  { href: "/dashboard/admin-debug", label: "Admin Debug", icon: Settings, module: "admin" },
  { href: "/dashboard/business-settings", label: "הגדרות עסק", icon: Settings },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
];

const mobileLinks: typeof links = [
  { href: "/dashboard", label: "בית", icon: Home },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users, module: "crm" },
  { href: "/dashboard/invoices", label: "חשבוניות", icon: FileText, module: "invoices" },
  { href: "/payments", label: "ספקים", icon: WalletCards, module: "supplier_management" },
];

type SearchClient = { id: string; name: string; email?: string | null };
type SearchInvoice = {
  id: string;
  invoiceNumber: string | null;
  description: string | null;
  amount: number;
  currency: string;
  client?: { name: string } | null;
};
type SearchTask = { id: string; title: string; supplier: string | null; status: string };
type SearchResult = { id: string; type: string; title: string; subtitle: string; href: string };

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchData, setSearchData] = useState<{
    clients: SearchClient[];
    invoices: SearchInvoice[];
    tasks: SearchTask[];
  }>({ clients: [], invoices: [], tasks: [] });

  useEffect(() => {
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then((settings) => {
        setOrganizationSettings(settings);
        if (settings.onboardingRequired && pathname !== "/onboarding") {
          router.replace("/onboarding");
        }
      })
      .catch(() => setOrganizationSettings(null));
  }, [pathname, router]);

  const moduleAllowed = (module?: BusinessModuleId | "admin") => {
    if (!module || module === "admin") return true;
    const enabledModules = Array.isArray(organizationSettings?.enabledModules)
      ? organizationSettings.enabledModules
      : null;
    return !enabledModules || enabledModules.includes(module);
  };
  const visibleLinks = links.filter((item) => moduleAllowed(item.module));
  const visibleMobileLinks = mobileLinks.filter((item) => moduleAllowed(item.module));
  const mobileMoreLinks = visibleLinks.filter((item) => !visibleMobileLinks.some((link) => link.href === item.href));

  function isActive(href: string) {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  }

  function logout() {
    localStorage.removeItem("token");
    router.push("/");
  }

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/dashboard");
  }

  function openHelp() {
    window.dispatchEvent(new Event("open-help-center"));
  }

  async function loadSearchData() {
    if (searchLoaded || searchLoading) return;
    setSearchLoading(true);
    setSearchError("");
    try {
      const [clientsResult, invoicesResult, tasksResult] = await Promise.allSettled([
        apiFetch<{ clients: SearchClient[] }>("/api/clients"),
        apiFetch<{ invoices: SearchInvoice[] }>("/api/invoices"),
        apiFetch<SearchTask[]>("/api/tasks"),
      ]);

      setSearchData({
        clients: clientsResult.status === "fulfilled" ? clientsResult.value.clients ?? [] : [],
        invoices: invoicesResult.status === "fulfilled" ? invoicesResult.value.invoices ?? [] : [],
        tasks: tasksResult.status === "fulfilled" ? tasksResult.value ?? [] : [],
      });
      setSearchLoaded(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }

  const searchResults = useMemo<SearchResult[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) return [];

    const clients = searchData.clients
      .filter((client) => `${client.name} ${client.email ?? ""}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((client) => ({
        id: `client-${client.id}`,
        type: "לקוח",
        title: client.name,
        subtitle: client.email ?? "לקוח",
        href: `/dashboard/clients/${client.id}`,
      }));

    const invoices = searchData.invoices
      .filter((invoice) => `${invoice.invoiceNumber ?? ""} ${invoice.description ?? ""} ${invoice.client?.name ?? ""}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        type: "חשבונית",
        title: invoice.invoiceNumber || invoice.client?.name || "חשבונית",
        subtitle: `${invoice.client?.name ?? "ללא לקוח"} · ${invoice.amount.toLocaleString("he-IL")} ${invoice.currency}`,
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

    return [...clients, ...invoices, ...tasks].slice(0, 10);
  }, [searchData, searchQuery]);

  function openSearchResult(href: string) {
    setSearchOpen(false);
    setSearchQuery("");
    router.push(href);
  }

  const moreActive = mobileMoreLinks.some((item) => isActive(item.href));

  return (
    <>
      <aside className="fixed right-0 top-0 z-50 hidden h-screen w-60 flex-col border-l border-[var(--border)] bg-surface-secondary/95 px-3 py-4 shadow-card backdrop-blur-xl lg:flex">
        <Link href="/dashboard" className="mb-6 block rounded-2xl px-3 py-3 transition hover:bg-surface-hover">
          <Logo size="md" showSubtitle />
        </Link>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pb-56">
              {visibleLinks.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "group relative flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-[15px] font-medium transition-all duration-200",
                  active
                    ? "border-accent-primary/30 bg-accent-primary/15 text-white shadow-[inset_-3px_0_0_#6366F1]"
                    : "text-[#E2E8F0] hover:border-[var(--border)] hover:bg-surface-hover hover:text-white",
                ].join(" ")}
              >
                <Icon className={["h-[18px] w-[18px]", active ? "text-accent-primary" : "text-ink-muted group-hover:text-ink-primary"].join(" ")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="fixed bottom-4 right-3 z-[60] w-[13.5rem] rounded-2xl border border-[var(--border)] bg-surface-card p-3 shadow-card">
          <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl bg-surface-hover/60 p-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#6366F1] text-sm font-bold text-white">AI</span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-[14px] font-bold text-white">מנהל מערכת AI</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#10B981]">
                <span className="h-2 w-2 rounded-full bg-[#10B981]" />
                מחובר
              </span>
            </span>
          </div>
          <button type="button" onClick={openHelp} className="mb-3 w-full rounded-xl bg-[#6366F1] px-4 py-2.5 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(99,102,241,0.28)] transition hover:bg-[#7C3AED]">
            עזרה
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center rounded-xl border border-[#EF4444] bg-transparent px-4 py-2.5 text-[14px] font-bold text-[#EF4444] transition hover:bg-[#EF4444] hover:text-white"
          >
            התנתק →
          </button>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-40 border-b border-transparent bg-surface-primary/90 backdrop-blur-xl lg:right-60">
        <div className="h-px bg-[linear-gradient(90deg,transparent,#6366F1,#8B5CF6,transparent)]" />
        <div className="flex h-16 items-center gap-2 px-4 md:gap-3 md:px-8">
          <button
            type="button"
            onClick={goBack}
            aria-label="חזרה"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-surface-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary lg:hidden"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <Link href="/dashboard" className="lg:hidden">
            <Logo size="md" iconOnly />
          </Link>
          <div className="relative mx-auto hidden w-full max-w-xl sm:block">
            <div className="flex h-11 items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-hover px-3 text-[#E2E8F0] shadow-card focus-within:border-accent-primary/60">
              <Search className="h-4 w-4 text-[#CBD5E1]" />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-medium text-[#F8FAFC] outline-none placeholder:text-[#CBD5E1]"
                placeholder="חיפוש לקוחות, חשבוניות, משימות..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                  void loadSearchData();
                }}
                onFocus={() => {
                  setSearchOpen(true);
                  void loadSearchData();
                }}
              />
              <kbd className="rounded-md border border-[var(--border)] bg-surface-card px-2 py-1 text-sm text-[#CBD5E1]">⌘K</kbd>
            </div>
            {searchOpen && searchQuery.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-12 z-[80] overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-secondary shadow-card">
                {searchLoading && <div className="p-4 text-base text-[#CBD5E1]">מחפש...</div>}
                {!searchLoading && searchError && <div className="p-4 text-base text-red-200">{searchError}</div>}
                {!searchLoading && !searchError && searchResults.length === 0 && (
                  <div className="p-4 text-base text-[#CBD5E1]">לא נמצאו תוצאות.</div>
                )}
                {!searchLoading && !searchError && searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openSearchResult(result.href)}
                    className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 text-right last:border-b-0 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-[#F8FAFC]">{result.title}</span>
                      <span className="mt-0.5 block truncate text-sm text-[#CBD5E1]">{result.subtitle}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-accent-primary/15 px-2.5 py-1 text-sm font-semibold text-[#C7D2FE]">{result.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 text-center text-[15px] font-semibold text-ink-primary sm:hidden">
            AI Office Worker
          </div>
          <button className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-surface-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">
            <Bell className="h-4 w-4" />
            <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-[var(--error)]" />
          </button>
          <button className="hidden items-center gap-2 rounded-xl border border-[var(--border)] bg-surface-card px-3 py-2 text-sm text-ink-secondary hover:bg-surface-hover hover:text-ink-primary md:flex">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-hover text-[13px] font-bold text-ink-primary">AI</span>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </header>

      {moreOpen && (
        <div className="fixed inset-0 z-[45] bg-black/55 backdrop-blur-sm lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-24 left-4 right-4 max-h-[70vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-surface-secondary p-3 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <strong className="text-ink-primary">עוד פעולות</strong>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="סגור תפריט"
                className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--border)] bg-surface-card text-ink-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mobileMoreLinks.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-3 text-[16px] font-semibold transition active:scale-95 ${
                      active
                        ? "border-accent-primary/40 bg-accent-primary/20 text-white"
                        : "border-[var(--border)] bg-surface-card text-[#E2E8F0]"
                    }`}
                  >
                    <Icon className={["h-5 w-5 shrink-0", active ? "text-accent-primary" : "text-ink-muted"].join(" ")} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 gap-1 border-t border-[var(--border)] bg-surface-secondary/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-card backdrop-blur-xl lg:hidden">
        {visibleMobileLinks.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] font-semibold transition active:scale-95 ${
                active ? "bg-accent-primary/20 text-white" : "text-[#E2E8F0] hover:bg-surface-hover"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={["h-5 w-5", active ? "text-accent-primary" : "text-ink-muted"].join(" ")} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] font-semibold transition active:scale-95 ${
            moreActive || moreOpen ? "bg-accent-primary/20 text-white" : "text-[#E2E8F0] hover:bg-surface-hover"
          }`}
          aria-expanded={moreOpen}
        >
          <Menu className={["h-5 w-5", moreActive || moreOpen ? "text-accent-primary" : "text-ink-muted"].join(" ")} />
          <span className="truncate">עוד</span>
        </button>
      </nav>
    </>
  );
}
