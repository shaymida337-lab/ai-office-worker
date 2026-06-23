"use client";

import { Bell, Sparkles } from "lucide-react";
import { colors, radius } from "@/lib/design-tokens";

export function NatalieTopBar({
  businessName,
  unreadCount = 0,
  onNotifications,
  onNatalie,
}: {
  businessName: string;
  unreadCount?: number;
  onNotifications: () => void;
  onNatalie: () => void;
}) {
  return (
    <header
      className="flex min-w-0 items-center justify-between gap-3 py-2"
      aria-label="סרגל עליון"
    >
      <div className="min-w-0 flex-1 text-right">
        <p className="text-xs font-semibold leading-5" style={{ color: colors.textMuted }}>
          העסק שלך
        </p>
        <h1
          className="truncate text-lg font-extrabold leading-tight md:text-xl"
          style={{ color: colors.textPrimary }}
        >
          {businessName}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onNotifications}
          aria-label="התראות"
          className={`relative grid h-11 w-11 place-items-center ${radius.control} border transition active:scale-[0.98]`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle, color: colors.textSecondary }}
        >
          <Bell className="h-5 w-5" strokeWidth={2} />
          {unreadCount > 0 && (
            <span
              className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colors.dangerText }}
              aria-hidden
            />
          )}
        </button>

        <button
          type="button"
          onClick={onNatalie}
          aria-label="פתח את נטלי"
          className={`inline-flex h-11 items-center gap-2 ${radius.control} px-3 font-bold transition active:scale-[0.98] md:px-4`}
          style={{
            backgroundColor: "#F3E8FF",
            border: "1px solid #E9D5FF",
            color: "#6D28D9",
          }}
        >
          <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          <span className="hidden text-sm sm:inline">נטלי</span>
        </button>
      </div>
    </header>
  );
}
