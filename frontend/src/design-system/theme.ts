import { semanticColorsLight } from "./tokens/colors";

/** CSS custom properties for theme injection (light default). */
export function natalieThemeCssVars(theme: Record<string, string> = semanticColorsLight): Record<string, string> {
  return {
    "--natalie-primary": theme.primary,
    "--natalie-primary-hover": theme.primaryHover,
    "--natalie-primary-soft": theme.primarySoft,
    "--natalie-success": theme.success,
    "--natalie-warning": theme.warning,
    "--natalie-danger": theme.danger,
    "--natalie-bg": theme.background,
    "--natalie-bg-soft": theme.backgroundSoft,
    "--natalie-surface": theme.surface,
    "--natalie-border": theme.border,
    "--natalie-border-subtle": theme.borderSubtle,
    "--natalie-text-primary": theme.textPrimary,
    "--natalie-text-secondary": theme.textSecondary,
    "--natalie-text-muted": theme.textMuted,
    "--natalie-overlay": theme.overlay,
  };
}

export const natalieThemeCssVarsLight = natalieThemeCssVars();
