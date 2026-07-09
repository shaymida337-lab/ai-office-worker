"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { GlobalHeader } from "@/components/natalie-ui";
import { colors, radius, type, dashboardHome } from "@/lib/design-tokens";
import { isNavItemVisible, type NavItemId } from "@/config/navVisibility";
import { apiFetch, clearAllAuthTokens } from "@/lib/api";
import { lockUiOverlay, unlockUiOverlay } from "@/lib/ui-overlay";
import { normalizeEnabledModules, type BusinessModuleId, type OrganizationSettings } from "@/lib/business-config";
import {
  BarChart3,
  Calendar,
  Camera,
  CheckSquare,
  ClipboardCheck,
  CircleDollarSign,
  FileBarChart,
  FileCheck,
  FileText,
  FileSpreadsheet,
  Home,
  Landmark,
  Menu,
  Megaphone,
  MessageCircle,
  Search,
  ShieldCheck,
  Settings,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from "lucide-react";

type NavLink = { id: NavItemId; href: string; label: string; icon: typeof Home; module?: BusinessModuleId | "admin" };

const links: NavLink[] = [
  { id: "dashboard", href: "/dashboard", label: "לוח בקרה", icon: Home },
  { id: "crm", href: "/crm", label: "ניהול לקוחות", icon: CircleDollarSign, module: "crm" },
  { id: "sales", href: "/dashboard/sales", label: "מכירות", icon: TrendingUp, module: "sales" },
  { id: "messageScans", href: "/message-scans", label: "סריקות הודעות", icon: Search },
  { id: "clients", href: "/dashboard/clients", label: "לקוחות", icon: Users, module: "crm" },
  { id: "invoices", href: "/dashboard/invoices", label: "חשבוניות לקוחות", icon: FileText },
  { id: "invoiceImport", href: "/dashboard/invoice-import", label: "ייבוא חשבוניות", icon: FileSpreadsheet },
  { id: "invoiceDrafts", href: "/dashboard/invoice-drafts", label: "טיוטות חשבונית", icon: FileCheck },
  { id: "invoiceDiagnostics", href: "/dashboard/invoice-diagnostics", label: "אבחון חשבוניות", icon: Search, module: "invoices" },
  { id: "documentReviews", href: "/dashboard/document-reviews", label: "מסמכים לבדיקה", icon: Search },
  { id: "supplierPayments", href: "/payments", label: "חשבוניות ספקים / תשלומים לספקים", icon: WalletCards },
  { id: "bank", href: "/dashboard/bank", label: "התאמת בנק", icon: Landmark },
  { id: "tasks", href: "/tasks", label: "משימות", icon: CheckSquare },
  { id: "calendar", href: "/dashboard/calendar", label: "יומן", icon: Calendar },
  { id: "collections", href: "/collections", label: "גבייה", icon: CircleDollarSign },
  { id: "social", href: "/social", label: "סושיאל", icon: Megaphone },
  { id: "whatsapp", href: "/dashboard/whatsapp", label: "וואטסאפ", icon: MessageCircle, module: "whatsapp" },
  { id: "reports", href: "/reports", label: "דוחות", icon: BarChart3 },
  { id: "accountant", href: "/dashboard/accountant", label: "רואה חשבון", icon: FileBarChart },
  { id: "camera", href: "/camera", label: "צילום חשבונית", icon: Camera, module: "documents" },
  { id: "adminDebug", href: "/dashboard/admin-debug", label: "בדיקות מנהל", icon: Settings, module: "admin" },
  { id: "accuracyDashboard", href: "/dashboard/system/accuracy", label: "לוח דיוק", icon: ShieldCheck, module: "admin" },
  { id: "verificationDashboard", href: "/dashboard/system/verification", label: "מרכז אימות", icon: ClipboardCheck, module: "admin" },
  { id: "businessSettings", href: "/dashboard/business-settings", label: "הגדרות עסק", icon: Settings },
  { id: "settings", href: "/dashboard/settings", label: "הגדרות", icon: Settings },
];

const mobileLinks: NavLink[] = [
  { id: "dashboard", href: "/dashboard", label: "היום", icon: Home },
  { id: "invoices", href: "/dashboard/invoices", label: "חשבוניות", icon: FileText },
  { id: "supplierPayments", href: "/payments", label: "ספקים", icon: WalletCards },
];

export function Nav() {
  const pathname = usePathname();
  const isDashboardHome = pathname === "/dashboard";
  const router = useRouter();
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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
    if (!moreOpen) return;
    lockUiOverlay();
    return () => unlockUiOverlay();
  }, [moreOpen]);

  const moduleAllowed = (module?: BusinessModuleId | "admin") => {
    if (module === "admin") return process.env.NEXT_PUBLIC_SHOW_ADMIN_DEBUG === "true";
    if (!module) return true;
    const enabledModules = organizationSettings
      ? normalizeEnabledModules(organizationSettings.enabledModules, organizationSettings.businessType)
      : null;
    return !enabledModules || enabledModules.includes(module);
  };
  const navVisible = (item: NavLink) => {
    if (item.id === "sales") {
      return moduleAllowed("sales") || moduleAllowed("crm");
    }
    if (!isNavItemVisible(item.id, organizationSettings?.businessType)) return false;
    return moduleAllowed(item.module);
  };
  const visibleLinks = links.filter(navVisible);
  const visibleMobileLinks = mobileLinks.filter(navVisible);
  const mobileMoreLinks = visibleLinks.filter((item) => !visibleMobileLinks.some((link) => link.href === item.href));

  function isActive(href: string) {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  }

  function logout() {
    clearAllAuthTokens();
    router.push("/");
  }

  function openHelp() {
    window.dispatchEvent(new Event("open-help-center"));
  }

  const moreActive = mobileMoreLinks.some((item) => isActive(item.href));

  return (
    <>
      <aside
        className="fixed right-0 top-0 z-50 hidden h-screen w-60 flex-col border-l px-3 py-4 backdrop-blur-xl lg:flex"
        style={{
          borderColor: colors.border,
          backgroundColor: "rgba(255,255,255,0.97)",
          boxShadow: "0 12px 40px rgba(20,40,90,0.08)",
        }}
      >
        <Link
          href="/dashboard"
          className="mb-5 block rounded-2xl px-3 py-3 transition"
          style={{ backgroundColor: "transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.bg; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
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
                className={`group relative flex min-h-10 items-center gap-3 rounded-xl border px-3 py-2 text-[14px] font-semibold transition-colors duration-150 ${
                  active ? "" : "border-transparent hover:border-[#E8EDF5] hover:bg-[#F4F6FB]"
                }`}
                style={
                  active
                    ? {
                        borderColor: "#CDD9FF",
                        backgroundColor: colors.accentSoft,
                        color: colors.accent,
                        boxShadow: `inset -3px 0 0 ${colors.accent}`,
                      }
                    : {
                        borderColor: "transparent",
                        color: colors.textPrimary,
                      }
                }
              >
                <Icon
                  className="h-[18px] w-[18px] shrink-0 transition-colors"
                  style={{ color: active ? colors.accent : colors.textSecondary }}
                />
                <span className="min-w-0 flex-1 truncate text-right">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div
          className="fixed bottom-4 right-3 z-[60] w-[13.5rem] rounded-2xl border p-3"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.surface,
            boxShadow: "0 12px 34px rgba(20,40,90,0.10)",
          }}
        >
          <div
            className="mb-3 flex min-w-0 items-center gap-3 rounded-xl p-2"
            style={{ backgroundColor: colors.bg }}
          >
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: colors.accent }}
            >
              נ
            </span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-[14px] font-bold" style={{ color: colors.textPrimary }}>
                נטלי
              </span>
              <span className="mt-0.5 block text-[12px] font-semibold" style={{ color: colors.textSecondary }}>
                AI Office Worker
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={openHelp}
            className="mb-3 w-full rounded-xl px-4 py-2.5 text-[14px] font-bold text-white transition"
            style={{
              backgroundColor: colors.accent,
              boxShadow: "0 12px 28px rgba(29,91,255,0.24)",
            }}
          >
            עזרה
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center justify-center rounded-xl border bg-white px-4 py-2.5 text-[14px] font-bold transition hover:bg-red-50"
            style={{ borderColor: "rgba(220,38,38,0.45)", color: colors.dangerText }}
          >
            התנתק
          </button>
        </div>
      </aside>

      <GlobalHeader
        sidebarOffset
        notificationCount={1}
        onNotificationsClick={() => router.push("/message-scans")}
      />

      {moreOpen && (
        <div className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm lg:hidden" onClick={() => setMoreOpen(false)}>
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
                    className={`flex min-h-[56px] items-center gap-3 rounded-2xl border px-4 py-3 text-base font-bold transition active:scale-95 ${
                      active
                        ? "border-accent-primary/40 bg-accent-primary/20 text-[#111827]"
                        : "border-[var(--border)] bg-surface-card text-[#111827]"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-[#64748b]" />
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
              className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 transition active:scale-95 ${
                isDashboardHome ? dashboardHome.navLabel : "text-xs font-semibold leading-[1.45]"
              } ${
                active ? "bg-[#E8EEFF] text-[#1D5BFF]" : "text-[#6B7686] hover:bg-[#F4F6FB]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={["h-5 w-5", active ? "text-[#1D5BFF]" : "text-[#8A94A6]"].join(" ")} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 transition active:scale-95 ${
            isDashboardHome ? dashboardHome.navLabel : "text-xs font-semibold leading-[1.45]"
          } ${
            moreActive || moreOpen ? "bg-[#E8EEFF] text-[#1D5BFF]" : "text-[#6B7686] hover:bg-[#F4F6FB]"
          }`}
          aria-expanded={moreOpen}
        >
          <Menu className={["h-5 w-5", moreActive || moreOpen ? "text-[#1D5BFF]" : "text-[#8A94A6]"].join(" ")} />
          <span className="truncate">עוד</span>
        </button>
      </nav>
    </>
  );
}
