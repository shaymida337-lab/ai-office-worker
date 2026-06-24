"use client";

import { useState } from "react";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";

const defaultSuggestions = [
  "סרקי חשבוניות",
  "הראי תשלומים דחופים",
  "קבעי פגישה",
  "הציגי משימות",
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
    <section id="natalie-command" className="text-right" aria-label="מה תרצה שאעשה">
      <h2 className={`${typography.sectionTitle} mb-4 leading-snug`} style={{ color: colors.textPrimary }}>
        מה תרצה שאעשה?
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row-reverse">
        <label htmlFor="natalie-command-input" className="sr-only">
          מה תרצה שאעשה?
        </label>
        <input
          id="natalie-command-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="תני לי משימה..."
          dir="rtl"
          className={`min-h-[52px] min-w-0 flex-1 border px-4 py-3 text-base ${radius.control} ${typography.body}`}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            color: colors.textPrimary,
          }}
        />
        <button
          type="submit"
          className={`${radius.control} ${button.primary} min-h-[52px] w-full shrink-0 px-6 sm:w-auto`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          שלח
        </button>
      </form>

      <ul className="mt-4 flex flex-wrap justify-end gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => handleSuggestion(suggestion)}
              className={`${radius.pill} border px-3.5 py-2 text-sm font-semibold transition hover:bg-[#F8FAFF]`}
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
