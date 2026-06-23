"use client";

import { Search } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function DocumentsSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section aria-label="חיפוש מסמכים">
      <label htmlFor="documents-search" className="sr-only">
        חיפוש מסמכים
      </label>
      <div
        className={`flex min-h-[56px] items-center gap-3 ${radius.lg} border px-4`}
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          boxShadow: "0 6px 24px rgba(15,23,42,0.05)",
        }}
      >
        <Search className="h-5 w-5 shrink-0" style={{ color: colors.accent }} strokeWidth={2.2} />
        <input
          id="documents-search"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder='לדוגמה: "החשבונית של בזק", "מסמכים מעל 500 ₪"'
          dir="rtl"
          className={`min-w-0 flex-1 border-0 bg-transparent py-3 ${typography.body} outline-none`}
          style={{ color: colors.textPrimary }}
        />
      </div>
    </section>
  );
}
