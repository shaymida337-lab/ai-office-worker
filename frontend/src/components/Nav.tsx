"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { isNavItemVisible, type NavItemId } from "@/config/navVisibility";
import { apiFetch } from "@/lib/api";
import { normalizeEnabledModules, type BusinessModuleId, type OrganizationSettings } from "@/lib/business-config";
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

type NavLink = { id: NavItemId; href: string; label: string; icon: typeof Home; module?: BusinessModuleId | "admin" };

const links: NavLink[] = [
  { id: "dashboard", href: "/dashboard", label: "לוח בקרה", icon: Home },
  { id: "crm", href: "/crm", label: "ניהול לקוחות", icon: CircleDollarSign, module: "crm" },
  { id: "messageScans", href: "/message-scans", label: "סריקות הודעות", icon: Search },
  { id: "clients", href: "/dashboard/clients", label: "לקוחות", icon: Users, module: "crm" },
  { id: "invoices", href: "/dashboard/invoices", label: "חשבוניות", icon: FileText, module: "invoices" },
  { id: "invoiceDiagnostics", href: "/dashboard/invoice-diagnostics", label: "אבחון חשבוניות", icon: Search, module: "invoices" },
  { id: "documentReviews", href: "/dashboard/document-reviews", label: "מסמכים לבדיקה", icon: Search, module: "supplier_management" },
  { id: "supplierPayments", href: "/payments", label: "תשלומי ספקים", icon: WalletCards, module: "supplier_management" },
  { id: "bank", href: "/dashboard/bank", label: "התאמת בנק", icon: Landmark, module: "supplier_management" },
  { id: "collections", href: "/collections", label: "גבייה", icon: CircleDollarSign, module: "collections" },
  { id: "tasks", href: "/tasks", label: "משימות", icon: CheckSquare, module: "tasks" },
  { id: "social", href: "/social", label: "סושיאל", icon: Megaphone },
  { id: "whatsapp", href: "/dashboard/whatsapp", label: "וואטסאפ", icon: MessageCircle, module: "whatsapp" },
  { id: "reports", href: "/reports", label: "דוחות", icon: BarChart3 },
  { id: "accountant", href: "/dashboard/accountant", label: "רואה חשבון", icon: FileBarChart },
  { id: "camera", href: "/camera", label: "צילום חשבונית", icon: Camera, module: "documents" },
  { id: "adminDebug", href: "/dashboard/admin-debug", label: "בדיקות מנהל", icon: Settings, module: "admin" },
  { id: "businessSettings", href: "/dashboard/business-settings", label: "הגדרות עסק", icon: Settings },
  { id: "settings", href: "/dashboard/settings", label: "הגדרות", icon: Settings },
];

const mobileLinks: NavLink[] = [
  { id: "dashboard", href: "/dashboard", label: "בית", icon: Home },
  { id: "clients", href: "/dashboard/clients", label: "לקוחות", icon: Users, module: "crm" },
  { id: "invoices", href: "/dashboard/invoices", label: "חשבוניות", icon: FileText, module: "invoices" },
  { id: "supplierPayments", href: "/payments", label: "ספקים", icon: WalletCards, module: "supplier_management" },
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
  }, [searchLoaded, searchLoading]);

  const moduleAllowed = (module?: BusinessModuleId | "admin") => {
    if (module === "admin") return process.env.NEXT_PUBLIC_SHOW_ADMIN_DEBUG === "true";
    if (!module) return true;
    const enabledModules = organizationSettings
      ? normalizeEnabledModules(organizationSettings.enabledModules, organizationSettings.businessType)
      : null;
    return !enabledModules || enabledModules.includes(module);
  };
  const navVisible = (item: NavLink) => (
    isNavItemVisible(item.id, organizationSettings?.businessType) && moduleAllowed(item.module)
  );
  const visibleLinks = links.filter(navVisible);
  const visibleMobileLinks = mobileLinks.filter(navVisible);
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
      setSearchError(err instanceof Error ? err.message : "החיפוש נכשל");
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
        subtitle: `${invoice.client?.name ?? "ללא לקוח"} · ${formatCurrency(invoice.amount, invoice.currency)}`,
        href: "/dashboard/invoices",
      }));

    const tasks = searchData.tasks
      .filter((task) => `${task.title} ${task.supplier ?? ""} ${task.status}`.toLowerCase().includes(query))
      .slice(0, 4)
      .map((task) => ({
        id: `task-${task.id}`,
        type: "משימה",
        title: task.title,
        subtitle: task.supplier ?? taskStatusLabel(task.status),
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
      <aside className="fixed right-0 top-0 z-50 hidden h-screen w-60 flex-col border-l border-[#e6eaf2] bg-white/95 px-3 py-4 shadow-[0_12px_40px_rgba(20,40,90,0.08)] backdrop-blur-xl lg:flex">
        <Link href="/dashboard" className="mb-6 block rounded-2xl px-3 py-3 transition hover:bg-[#f4f6fb]">
          <Logo size="md" showSubtitle />
        </Link>

        <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto pb-56" aria-label="ניווט ראשי">
              {visibleLinks.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "group relative flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-[15px] font-bold transition-all duration-200",
                  active
                    ? "border-[#cdd9ff] bg-[#e8eeff] text-[#1d5bff] shadow-[inset_-3px_0_0_#1d5bff]"
                    : "border-transparent text-[#0e1116] hover:border-[#e6eaf2] hover:bg-[#f4f6fb] hover:text-[#1d5bff]",
                ].join(" ")}
              >
                <Icon className={["h-[19px] w-[19px] shrink-0", active ? "text-[#1d5bff]" : "text-[#6b7686] group-hover:text-[#1d5bff]"].join(" ")} />
                <span className="min-w-0 flex-1 truncate text-right">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="fixed bottom-4 right-3 z-[60] w-[13.5rem] rounded-2xl border border-[#e6eaf2] bg-white p-3 shadow-[0_12px_34px_rgba(20,40,90,0.10)]">
          <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl bg-[#f4f6fb] p-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1d5bff] text-sm font-bold text-white">חכם</span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-[14px] font-bold text-[#0e1116]">מנהל מערכת חכם</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#1faa59]">
                <span className="h-2 w-2 rounded-full bg-[#1faa59]" />
                מחובר
              </span>
            </span>
          </div>
          <button type="button" onClick={openHelp} className="mb-3 w-full rounded-xl bg-[#1d5bff] px-4 py-2.5 text-[14px] font-bold text-white shadow-[0_12px_28px_rgba(29,91,255,0.24)] transition hover:bg-[#1746c7]">
            עזרה
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center rounded-xl border border-[#dc2626]/45 bg-white px-4 py-2.5 text-[14px] font-bold text-[#dc2626] transition hover:bg-red-50"
          >
            התנתק
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
            <div className="flex h-12 items-center gap-3 rounded-2xl border border-[#e6eaf2] bg-white px-4 text-[#0e1116] shadow-[0_8px_24px_rgba(20,40,90,0.06)] transition focus-within:border-[#1d5bff] focus-within:shadow-[0_0_0_4px_rgba(29,91,255,0.10)]">
              <Search className="h-5 w-5 shrink-0 text-[#1d5bff]" />
              <input
                ref={searchInputRef}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] font-semibold text-[#0e1116] outline-none placeholder:text-[#6b7686]"
                placeholder="חיפוש לקוחות, חשבוניות, ספקים ומשימות"
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
              <kbd className="rounded-md border border-[#e6eaf2] bg-[#f4f6fb] px-2 py-1 text-sm font-semibold text-[#6b7686]">Ctrl K</kbd>
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
            עובד משרד חכם
          </div>
          <button
            type="button"
            onClick={() => router.push("/message-scans")}
            aria-label="פתח סריקות הודעות"
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-surface-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-[var(--error)]" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/settings")}
            aria-label="פתח הגדרות"
            className="hidden items-center gap-2 rounded-xl border border-[var(--border)] bg-surface-card px-3 py-2 text-sm text-ink-secondary hover:bg-surface-hover hover:text-ink-primary md:flex"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-hover text-[13px] font-bold text-ink-primary">חכם</span>
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

function taskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "פתוח",
    todo: "לביצוע",
    "in-progress": "בתהליך",
    done: "בוצע",
    completed: "בוצע",
  };
  return labels[status] ?? status;
}

function formatCurrency(amount: number, currency: string) {
  const symbols: Record<string, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  return `${symbols[currency] ?? currency} ${amount.toLocaleString("he-IL")}`;
}
