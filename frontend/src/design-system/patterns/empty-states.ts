import { legacyColorMap } from "../tokens/colors";
import { elevation } from "../tokens/elevation";
import { radius } from "../tokens/radius";
import { spacing } from "../tokens/spacing";
import { typography } from "../tokens/typography";

const c = legacyColorMap;

export const emptyStatePatterns = {
  container: `${radius.lg} border ${elevation.low} ${spacing.card} text-center`,
  containerStyle: {
    backgroundColor: c.surface,
    borderColor: c.borderSubtle,
    backgroundImage: "linear-gradient(180deg, rgba(29,91,255,0.03) 0%, rgba(255,255,255,0) 100%)",
  },
  iconWrap: "mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl",
  iconStyle: { backgroundColor: c.accentSoft, color: c.accent },
  title: typography.section,
  titleCompact: typography.h3,
  hint: `${typography.body} mx-auto mt-2 max-w-md`,
  hintStyle: { color: c.textSecondary },
  /** Copy principles */
  principles: [
    "Reduce stress — never blame the user",
    "Explain what Natalie will do next",
    "Never feel broken or empty",
  ] as const,
} as const;
