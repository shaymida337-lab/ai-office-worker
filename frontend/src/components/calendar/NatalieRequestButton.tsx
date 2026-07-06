"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, CalendarSearch, CalendarX2, Move, Sparkles } from "lucide-react";
import { colors, radius, button } from "@/lib/design-tokens";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

const ACTIONS = [
  {
    id: "schedule",
    label: "קבע פגישה",
    message: "עזרי לי לקבוע פגישה חדשה",
    icon: CalendarPlus,
  },
  {
    id: "cancel",
    label: "בטל פגישה",
    message: "עזרי לי לבטל פגישה",
    icon: CalendarX2,
  },
  {
    id: "move",
    label: "הזז פגישה",
    message: "עזרי לי להזיז פגישה",
    icon: Move,
  },
  {
    id: "slot",
    label: "מצא זמן פנוי",
    message: "מצאי לי חלון פנוי ביומן",
    icon: CalendarSearch,
  },
] as const;

export function NatalieRequestButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`} data-testid="natalie-request-button">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`${radius.control} ${button.primary} flex w-full min-h-[56px] items-center justify-center gap-2 text-base font-black transition duration-200 hover:brightness-[0.97] active:scale-[0.99]`}
        style={{
          backgroundColor: colors.accent,
          border: `1px solid ${colors.accent}`,
          color: colors.surface,
        }}
        aria-expanded={open}
      >
        <Sparkles className="h-5 w-5" />
        בקש מנטלי
      </button>

      {open && (
        <div
          className={`${radius.card} absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-20 overflow-hidden border shadow-[0_20px_56px_rgba(15,23,42,0.16)]`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 border-b border-[#F1F5F9] px-4 py-3.5 text-right transition hover:bg-[#F8FAFC] last:border-b-0"
                onClick={() => {
                  setOpen(false);
                  openNatalieAssistant(action.message);
                }}
              >
                <span className="text-sm font-black text-[#111827]">{action.label}</span>
                <Icon className="h-4 w-4 text-[#1D4ED8]" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
