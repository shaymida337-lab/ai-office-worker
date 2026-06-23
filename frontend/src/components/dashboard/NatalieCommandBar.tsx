"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";

const defaultSuggestions = [
  "מה דחוף היום?",
  "כמה יוצא השבוע?",
  "מי מחכה לתשלום?",
  "סרקי מסמכים עכשיו",
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
    <section
      id="natalie-command"
      className={`${radius.lg} border p-5 md:p-6`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 10px 40px rgba(15,23,42,0.06)",
        backgroundImage: "linear-gradient(180deg, rgba(109,40,217,0.04) 0%, rgba(255,255,255,0) 100%)",
      }}
      aria-label="פקודה לנטלי"
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl"
          style={{ backgroundColor: "#F3E8FF", color: "#6D28D9" }}
        >
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h2 className={typography.cardTitle} style={{ color: colors.textPrimary }}>
          מה תרצה שנטלי תעשה?
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="natalie-command-input" className="sr-only">
          מה תרצה שנטלי תעשה?
        </label>
        <input
          id="natalie-command-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="תגיד לי מה לעשות..."
          dir="rtl"
          className={`min-h-[52px] min-w-0 flex-1 border px-4 py-3 ${radius.control} ${typography.body}`}
          style={{
            backgroundColor: colors.bgSoft,
            borderColor: colors.border,
            color: colors.textPrimary,
          }}
        />
        <button
          type="submit"
          className={`${radius.control} ${button.primary} w-full shrink-0 sm:w-auto`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          שלח
        </button>
      </form>

      <ul className="mt-4 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => handleSuggestion(suggestion)}
              className={`${radius.pill} border px-3 py-2 text-sm font-bold transition hover:shadow-sm`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
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
