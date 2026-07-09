/** Approved Natalie Design System tokens — shared class recipes. */
export const natalie = {
  page: "min-h-screen bg-[var(--natalie-bg-page,#F3F6FF)] text-[var(--natalie-text-primary,#0F172A)]",
  header:
    "fixed inset-x-0 top-0 z-40 border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/95 backdrop-blur",
  card: "rounded-2xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm",
  cardLg: "rounded-3xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm",
  title: "text-[var(--natalie-text-primary,#0F172A)]",
  subtitle: "text-[var(--natalie-text-muted,#64748B)]",
  accent: "text-[#1D4ED8]",
  accentSoft: "bg-[#EEF2FF] border-[#D1DCFA] text-[#1E40AF]",
  input:
    "w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 font-semibold text-[#111827] shadow-sm outline-none transition focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#BFDBFE] dark:border-[var(--natalie-border,#334155)] dark:bg-[var(--natalie-surface-elevated,#1E293B)] dark:text-[var(--natalie-text-primary,#F8FAFC)]",
  timelineItem: "rounded-xl border border-[#E6ECF8] bg-[#F8FAFF]",
} as const;

export const buttonVariants = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#1D4ED8] bg-[#DBEAFE] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#BFDBFE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  secondarySm:
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#B91C1C] bg-[#FEE2E2] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FECACA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60",
  warn:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[#C2410C] bg-[#FFEDD5] px-4 py-3 text-base font-black text-[#111827] transition hover:bg-[#FED7AA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C] disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-2 text-sm font-bold text-[#1E40AF] transition hover:bg-[#E0E7FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]",
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
