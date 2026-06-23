"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, type as typography } from "@/lib/design-tokens";

export function PaymentsCompletedSection({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;

  return (
    <details
      className={`${radius.lg} border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
    >
      <summary className="cursor-pointer list-none px-5 py-5 md:px-6" style={{ color: colors.textPrimary }}>
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
          <span className={typography.cardTitle}>היום כבר סיימתי</span>
        </div>
      </summary>
      <ul className="grid gap-2 border-t px-5 pb-5 pt-3 md:px-6" style={{ borderColor: colors.borderSubtle }}>
        {lines.map((line, index) => (
          <li key={`${line}-${index}`} className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.5} />
            <span className={`${typography.body} leading-7`} style={{ color: colors.successText }}>
              {line}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
