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
    <section className="dashboard-fade-in min-w-0 text-right" aria-label="בקשה מנטלי">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
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
          className={`min-h-11 min-w-0 w-full border px-4 py-3 transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${dashboardHome.prompt} ${radius.control}`}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            color: colors.textPrimary,
            boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            outlineColor: colors.accent,
          }}
        />
        <button
          type="submit"
          className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} min-h-11 w-full shrink-0 px-5 transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.99] sm:hidden`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
            outlineColor: colors.surface,
          }}
        >
          שלח לנטלי
        </button>
      </form>

      {suggestions.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap justify-end gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => handleSuggestion(suggestion)}
                className={`${radius.pill} min-h-11 border px-3 py-1.5 transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${dashboardHome.prompt}`}
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                  color: colors.textSecondary,
                  outlineColor: colors.accent,
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
