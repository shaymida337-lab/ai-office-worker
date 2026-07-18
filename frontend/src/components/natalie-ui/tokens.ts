/** Approved Natalie Design System tokens — shared class recipes. */
export const natalie = {
  page: "min-h-screen bg-[var(--natalie-bg-page,#F3F6FF)] text-[var(--natalie-text-primary,#0F172A)]",
  header:
    "fixed inset-x-0 top-0 z-40 border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]",
  card: "rounded-2xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm",
  cardLg: "rounded-3xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm",
  title: "text-[var(--natalie-text-primary,#0F172A)]",
  subtitle: "text-[var(--natalie-text-muted,#64748B)]",
  accent: "text-[#1D4ED8]",
  accentSoft: "bg-[#EEF2FF] border-[#D1DCFA] text-[#1E40AF]",
  input:
    "w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none transition focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE] dark:border-[var(--natalie-border,#334155)] dark:bg-[var(--natalie-surface-elevated,#1E293B)] dark:text-[var(--natalie-text-primary,#F8FAFC)]",
  timelineItem: "rounded-xl border border-[#E6ECF8] bg-[#F8FAFF] dark:border-[#1F2A44] dark:bg-[#0F172A]",
} as const;

/** Shared AppShell layout rhythm — 8px spacing system.
 * The header is two rows on mobile (controls row + full-width search = 6.75rem)
 * and a single 4.5rem row from md up; every offset below must stay in sync. */
export const shellLayout = {
  headerHeight: "4.5rem",
  pageTitleHeight: "4rem",
  contentMaxWidth: "mx-auto w-full max-w-6xl xl:max-w-7xl",
  contentPaddingX: "px-4 md:px-6",
  searchWidth: "w-full max-w-md",
  sectionGap: "gap-4",
  mainPaddingBottom: "pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]",
  mainPaddingTop: "pt-4",
  headerOffset: "pt-[calc(6.75rem+env(safe-area-inset-top,0px))] md:pt-[calc(4.5rem+env(safe-area-inset-top,0px))]",
  headerWithTitleOffset: "pt-[calc(10.75rem+env(safe-area-inset-top,0px))] md:pt-[calc(8.5rem+env(safe-area-inset-top,0px))]",
  pageTitleTop: "top-[calc(6.75rem+env(safe-area-inset-top,0px))] md:top-[calc(4.5rem+env(safe-area-inset-top,0px))]",
  fabPosition:
    "fixed z-50 end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] md:end-6",
} as const;

export const buttonVariants = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#DBEAFE] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#BFDBFE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#F3F4F6] dark:border-[#1F2A44] dark:bg-[#111827] dark:text-[#F1F5F9] dark:hover:bg-[#1E293B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  secondarySm:
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6] dark:border-[#1F2A44] dark:bg-[#111827] dark:text-[#F1F5F9] dark:hover:bg-[#1E293B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FECACA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60",
  warn:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#C2410C] bg-[#FFEDD5] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FED7AA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C] disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-2 text-sm font-bold text-[#1E40AF] transition hover:bg-[#E0E7FF] dark:border-[#27395F] dark:bg-[#0F1E42] dark:text-[#93C5FD] dark:hover:bg-[#16295B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export type StatusBadgeTone = "success" | "warn" | "danger" | "info" | "neutral";

export const statusBadgeStyles: Record<StatusBadgeTone, string> = {
  success: "border-[#86EFAC] bg-[#ECFDF5] text-[#065F46]",
  warn: "border-[#FCD34D] bg-[#FFFBEB] text-[#92400E]",
  danger: "border-[#FCA5A5] bg-[#FEF2F2] text-[#7F1D1D]",
  info: "border-[#93C5FD] bg-[#EFF6FF] text-[#1E40AF]",
  neutral: "border-[#E5E7EB] bg-[#F8FAFC] text-[#4B5563]",
};
