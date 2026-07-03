/** Natalie Design System — icon sizing and stroke. */

export const iconSize = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export const iconStroke = {
  regular: 2,
  emphasis: 2.2,
  bold: 2.4,
} as const;

export const iconClass = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
  xl: "h-8 w-8",
} as const;

/** Icon color roles — always semantic, never raw hex in components. */
export const iconTone = {
  primary: "text-[var(--natalie-primary)]",
  secondary: "text-[var(--natalie-text-secondary)]",
  muted: "text-[var(--natalie-text-muted)]",
  success: "text-[var(--natalie-success)]",
  warning: "text-[var(--natalie-warning)]",
  danger: "text-[var(--natalie-danger)]",
  onPrimary: "text-white",
} as const;
