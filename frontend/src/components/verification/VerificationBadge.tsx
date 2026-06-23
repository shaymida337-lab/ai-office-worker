import { colors, radius } from "@/lib/design-tokens";
import {
  verificationBadgeLabel,
  type VerificationBadgeTone,
} from "@/lib/verificationCenterFormat";

const toneStyles: Record<VerificationBadgeTone, { text: string; bg: string; border: string }> = {
  saved: {
    text: colors.successText,
    bg: colors.successBg,
    border: colors.successBorder,
  },
  review: {
    text: colors.warnText,
    bg: colors.warnBg,
    border: colors.warnBorder,
  },
  blocked: {
    text: colors.dangerText,
    bg: colors.dangerBg,
    border: colors.dangerBorder,
  },
  duplicate: {
    text: colors.textSecondary,
    bg: "#F3F4F6",
    border: colors.border,
  },
  notFinancial: {
    text: colors.infoText,
    bg: colors.infoBg,
    border: colors.infoBorder,
  },
  neutral: {
    text: colors.textSecondary,
    bg: colors.surface,
    border: colors.border,
  },
};

export function VerificationBadge({ tone }: { tone: VerificationBadgeTone }) {
  const palette = toneStyles[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${radius.pill}`}
      style={{ color: palette.text, backgroundColor: palette.bg, borderColor: palette.border }}
    >
      {verificationBadgeLabel(tone)}
    </span>
  );
}
