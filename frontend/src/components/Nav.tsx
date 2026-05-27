"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
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
  Menu,
  Megaphone,
  MessageCircle,
  Search,
  Settings,
  Users,
  WalletCards,
  X,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "לוח בקרה", icon: Home },
  { href: "/crm", label: "CRM", icon: CircleDollarSign },
  { href: "/message-scans", label: "סריקות הודעות", icon: Search },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users },
  { href: "/dashboard/invoices", label: "חשבוניות", icon: FileText },
  { href: "/payments", label: "תשלומי ספקים", icon: WalletCards },
  { href: "/collections", label: "גבייה", icon: CircleDollarSign },
  { href: "/tasks", label: "משימות", icon: CheckSquare },
  { href: "/social", label: "סושיאל", icon: Megaphone },
  { href: "/dashboard/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/reports", label: "דוחות", icon: BarChart3 },
  { href: "/dashboard/accountant", label: "רואה חשבון", icon: FileBarChart },
  { href: "/camera", label: "צילום חשבונית", icon: Camera },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
];

const mobileLinks = [
  { href: "/dashboard", label: "בית", icon: Home },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users },
  { href: "/dashboard/invoices", label: "חשבוניות", icon: FileText },
  { href: "/payments", label: "ספקים", icon: WalletCards },
];

const mobileMoreLinks = links.filter((item) => !mobileLinks.some((link) => link.href === item.href));

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

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

  const moreActive = mobileMoreLinks.some((item) => isActive(item.href));

  return (
    <>
      <aside className="fixed right-0 top-0 z-50 hidden h-screen w-60 flex-col border-l border-[var(--border)] bg-surface-secondary/95 px-3 py-4 shadow-card backdrop-blur-xl lg:flex">
        <Link href="/dashboard" className="mb-6 block rounded-2xl px-3 py-3 transition hover:bg-surface-hover">
          <Logo size="md" showSubtitle />
        </Link>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pb-56">
          {links.map((item) => {
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
          <div className="mx-auto hidden h-10 w-full max-w-xl items-center gap-3 rounded-xl border border-[var(--border)] bg-surface-hover px-3 text-ink-muted shadow-card sm:flex">
            <Search className="h-4 w-4" />
            <span className="flex-1 text-sm">חיפוש לקוחות, חשבוניות, משימות...</span>
            <kbd className="rounded-md border border-[var(--border)] bg-surface-card px-2 py-1 text-[13px] text-ink-muted">⌘K</kbd>
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
        {mobileLinks.map((item) => {
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
