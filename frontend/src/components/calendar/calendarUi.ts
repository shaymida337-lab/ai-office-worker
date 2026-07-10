import { buttonVariants, natalie } from "@/components/natalie-ui/tokens";

/** Shared Natalie Design System class recipes for calendar presentation. */
export const calendarUi = {
  emptyWrap: `mb-4 rounded-2xl border border-dashed px-4 py-5 text-right ${natalie.accentSoft}`,
  emptyTitle: `text-lg font-black ${natalie.title}`,
  emptySubtitle: `mt-2 text-base font-semibold ${natalie.subtitle}`,
  emptyInner: `max-w-xs rounded-2xl border border-dashed px-5 py-6 ${natalie.accentSoft}`,
  gridShell: `${natalie.card} overflow-hidden shadow-[0_4px_16px_rgba(15,23,42,0.06)]`,
  gridHeader: "grid grid-cols-7 border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)]",
  gridHeaderCell: `px-1 py-2 text-center text-[11px] font-extrabold tracking-wide ${natalie.subtitle}`,
  gridDivide: "grid grid-cols-7 divide-x divide-y divide-[var(--natalie-border,#D9E2F2)] border-t-0",
  timelineShell: `overflow-hidden ${natalie.card} bg-[var(--natalie-surface-elevated,#F8FAFF)] shadow-[0_4px_16px_rgba(15,23,42,0.06)]`,
  timelineLane: "relative min-w-0 flex-1 border-l border-[var(--natalie-border,#D9E2F2)]",
  timelineHour: "pointer-events-none absolute inset-x-0 border-t border-[var(--natalie-border,#D9E2F2)]/80",
  timelineRuler: `w-12 shrink-0 bg-[var(--natalie-card-bg,#ffffff)] sm:w-14`,
  timelineRulerLabel: `relative flex items-start justify-center pt-1 text-[10px] font-bold ${natalie.subtitle} sm:text-xs`,
  timelineFooter: `mt-2 text-xs font-semibold ${natalie.subtitle}`,
  weekColumnBase: `${natalie.card} min-h-[150px] p-2.5 transition`,
  weekColumnToday: "border-[#1D4ED8]/35 bg-[#EFF6FF] shadow-[0_6px_20px_rgba(29,78,216,0.08)]",
  weekColumnDefault: "shadow-[0_4px_16px_rgba(15,23,42,0.04)]",
  weekDayEmpty: `rounded-xl border border-dashed border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)] px-2 py-4 text-center`,
  drawerPanel: `h-full w-full max-w-[460px] overflow-y-auto border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] p-4 shadow-2xl sm:p-5`,
  drawerHero: `${natalie.cardLg} bg-gradient-to-b from-[var(--natalie-card-bg,#ffffff)] to-[var(--natalie-surface-elevated,#F8FAFF)] p-4 shadow-[0_8px_28px_rgba(15,23,42,0.08)]`,
  drawerSection: `${natalie.card} p-3`,
  drawerMetaGrid: `grid grid-cols-2 gap-2 rounded-xl border border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] p-3 text-sm`,
  queuePanel: `${natalie.card} p-4 ${natalie.title}`,
  queueItem: (focused: boolean) =>
    `rounded-xl border bg-[var(--natalie-surface-elevated,#F8FAFF)] p-3 ${
      focused ? "border-[#1D4ED8] ring-2 ring-[#BFDBFE]" : "border-[var(--natalie-border,#D9E2F2)]"
    }`,
  dayCellInMonth: "bg-[var(--natalie-card-bg,#ffffff)] hover:bg-[var(--natalie-surface-elevated,#F8FAFF)] hover:brightness-[0.99]",
  dayCellOutMonth: "bg-[var(--natalie-surface-elevated,#F8FAFF)] hover:bg-[#F3F4F6]",
  clientName: `truncate font-black text-[var(--natalie-text-primary,#0F172A)]`,
  clientNameMuted: `truncate text-xs font-semibold text-[var(--natalie-text-muted,#64748B)]`,
  natalieChip: "inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-bold text-[#4338CA]",
  btnNav: buttonVariants.secondarySm,
  btnPrimary: buttonVariants.primary,
  btnDanger: buttonVariants.danger,
} as const;

export function weekColumnClass(isToday: boolean) {
  return `${calendarUi.weekColumnBase} ${isToday ? calendarUi.weekColumnToday : calendarUi.weekColumnDefault}`;
}
