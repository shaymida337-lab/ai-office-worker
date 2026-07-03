/**
 * Natalie Design System — Sprint 15 Foundation
 *
 * Single source of truth for tokens, patterns, and rules.
 * Import from `@/design-system` in all new code.
 *
 * Legacy: `@/lib/design-tokens` re-exports for backward compatibility.
 */

export * from "./tokens";
export * from "./patterns";
export * from "./rules";
export * from "./theme";
export * from "./inventory";
export { kpiAccentStyles, type KpiAccent } from "./legacy/kpi";

/** Legacy flat color map — prefer semanticColorsLight in new code. */
export { legacyColorMap } from "./tokens/colors";
export { legacyTypography } from "./tokens/typography";
export { legacyShadow } from "./tokens/elevation";
export { legacyButton } from "./patterns/buttons";
