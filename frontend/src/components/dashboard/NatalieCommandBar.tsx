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
      <h2 className="mb-3 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        מה תרצה שאעשה?
      </h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row-reverse">
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
          className={`min-h-[48px] min-w-0 flex-1 border px-3 py-2.5 text-base ${radius.control}`}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            color: colors.textPrimary,
          }}
        />
        <button
          type="submit"
          className={`${radius.control} ${button.primary} min-h-[48px] w-full shrink-0 px-5 sm:w-auto`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          שלח
        </button>
      </form>

      <ul className="mt-2 hidden flex-wrap justify-end gap-1.5 md:flex">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => handleSuggestion(suggestion)}
              className={`${radius.pill} border px-3 py-1.5 text-xs font-semibold`}
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
