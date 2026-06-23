"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function WorkSummary({ lines, loading = false }: { lines: string[]; loading?: boolean }) {
  return (
    <section aria-label="מה נטלי עשתה היום">
      <h2 className={`${typography.sectionTitle} mb-4 leading-snug`} style={{ color: colors.textPrimary }}>
        מה נטלי עשתה היום
      </h2>

      <div
        className={`${radius.lg} border p-5 md:p-6`}
        style={{
          backgroundColor: colors.successBg,
          borderColor: colors.successBorder,
        }}
      >
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-5 w-3/4 animate-pulse rounded-lg bg-white/60" />
            ))}
          </div>
        ) : (
          <ul className="grid gap-3">
            {lines.map((line, index) => (
              <li key={`${line}-${index}`} className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0"
                  style={{ color: colors.successText }}
                  strokeWidth={2.5}
                />
                <span className={`${typography.body} leading-7`} style={{ color: colors.successText }}>
                  {line}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
