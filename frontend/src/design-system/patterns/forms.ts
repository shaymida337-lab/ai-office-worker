import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { typography } from "../tokens/typography";

const c = legacyColorMap;

export const formPatterns = {
  field: "grid gap-2",
  label: typography.caption,
  labelStyle: { color: c.textSecondary },
  input: `min-h-[52px] w-full border px-4 py-3 ${radius.control} ${typography.body}`,
  inputStyle: { backgroundColor: c.bgSoft, borderColor: c.border, color: c.textPrimary },
  inputFocus: "focus:outline-none focus:ring-2 focus:ring-[#1D5BFF] focus:ring-offset-1",
  textarea: `min-h-[120px] w-full resize-y border px-4 py-3 ${radius.control} ${typography.body}`,
  select: `min-h-[52px] w-full border px-4 py-3 ${radius.control} ${typography.body}`,
  checkbox: "h-5 w-5 rounded border",
  radio: "h-5 w-5",
  switch: "h-6 w-11 rounded-full",
  helper: typography.caption,
  helperStyle: { color: c.textMuted },
  error: typography.caption,
  errorStyle: { color: c.dangerText },
  errorBorder: { borderColor: c.dangerBorder },
} as const;
