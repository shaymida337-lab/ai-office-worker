import { colors, radius, type as typography } from "@/lib/design-tokens";
import {
  formatVerificationDuration,
  formatVerificationPercent,
} from "@/lib/verificationCenterFormat";
import type { VerificationTimelineStage } from "@/types/verificationCenter";

const statusColors: Record<VerificationTimelineStage["status"], string> = {
  completed: colors.successText,
  warning: colors.warnText,
  failed: colors.dangerText,
  skipped: colors.textMuted,
  pending: colors.infoText,
  unknown: colors.textSecondary,
};

export function VerificationTimeline({ stages }: { stages: VerificationTimelineStage[] }) {
  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => (
        <li key={stage.id} className="relative pr-6">
          {index < stages.length - 1 ? (
            <span
              className="absolute right-[7px] top-5 h-[calc(100%+0.25rem)] w-px"
              style={{ backgroundColor: colors.border }}
            />
          ) : null}
          <span
            className="absolute right-0 top-1.5 h-3.5 w-3.5 rounded-full border-2"
            style={{ borderColor: statusColors[stage.status], backgroundColor: colors.surface }}
          />
          <div className={`${radius.control} border p-3`} style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={`${typography.body} font-semibold`} style={{ color: colors.textPrimary }}>
                {stage.label}
              </div>
              <div className="flex flex-wrap gap-2 text-xs" style={{ color: colors.textMuted }}>
                <span style={{ color: statusColors[stage.status] }}>{stage.status}</span>
                <span>ביטחון: {formatVerificationPercent(stage.confidence)}</span>
                <span>משך: {formatVerificationDuration(stage.durationMs)}</span>
              </div>
            </div>
            {stage.reason ? (
              <p className={`${typography.meta} mt-2`} style={{ color: colors.textSecondary }}>
                סיבה: {stage.reason}
              </p>
            ) : null}
            {stage.summary ? (
              <p className={`${typography.meta} mt-1`} style={{ color: colors.textMuted }}>
                {stage.summary}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
