"use client";

import { useState } from "react";
import { colors, radius, button, dashboardHome } from "@/lib/design-tokens";

const defaultSuggestions = [
  "מה דחוף היום?",
  "איזה תשלומים פתוחים?",
  "תיצור לי משימה",
  "תקבע לי פגישה",
];

export function NatalieCommandBar({
  onSubmit,
  onScan,
  suggestions = defaultSuggestions,
}: {
  onSubmit: (value: string) => void;
  onScan?: () => void;
  suggestions?: string[];
}) {
  const [value, setValue] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    onSubmit(trimmed);
  }

  function handleSuggestion(text: string) {
    if (text.includes("סרק")) {
      onScan?.();
      return;
    }
    setValue("");
    onSubmit(text);
  }

  return (
    <section id="natalie-command" className="text-right" aria-label="בקשה מנטלי">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor="natalie-command-input" className="sr-only">
          בקש משהו מנטלי
        </label>
        <input
          id="natalie-command-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="בקש משהו מנטלי..."
          dir="rtl"
          className={`min-h-[52px] min-w-0 w-full border px-4 py-3 ${dashboardHome.prompt} ${radius.control}`}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            color: colors.textPrimary,
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }}
        />
        <button
          type="submit"
          className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} min-h-[48px] w-full shrink-0 px-5 sm:hidden`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          שלח לנטלי
        </button>
      </form>

      <ul className="mt-2.5 flex flex-wrap justify-end gap-1.5">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => handleSuggestion(suggestion)}
              className={`${radius.pill} min-h-[36px] border px-3 py-1.5 ${dashboardHome.prompt}`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
                color: colors.textSecondary,
              }}
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
