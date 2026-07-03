/** Natalie Design System — naming conventions. */

export const namingConventions = {
  tokens: {
    rule: "Semantic names only — never page-specific (e.g. dashboardBlue)",
    examples: ["colors.primary", "typography.body", "elevation.high", "space.4"],
  },
  components: {
    rule: "PascalCase React components; prefix Natalie for employee-facing surfaces",
    examples: ["NatalieBriefing", "NatalieRecommendationCard", "StatusPill", "KpiCard"],
  },
  patterns: {
    rule: "camelCase exports ending in Patterns (e.g. buttonPatterns)",
    examples: ["buttonPatterns.primary", "cardPatterns.decision", "emptyStatePatterns.container"],
  },
  css: {
    rule: "Tailwind utilities from tokens only; no arbitrary values except approved scale",
    forbidden: ["text-[13px]", "p-[18px]", "rounded-[10px]", "shadow-[custom]"],
  },
  files: {
    tokens: "frontend/src/design-system/tokens/<category>.ts",
    patterns: "frontend/src/design-system/patterns/<category>.ts",
    rules: "frontend/src/design-system/rules/<topic>.ts",
    components: "frontend/src/components/<domain>/<Component>.tsx",
  },
  imports: {
    preferred: 'import { semanticColorsLight, typography, buttonPatterns } from "@/design-system"',
    legacy: 'import { colors, type } from "@/lib/design-tokens" (deprecated — migrate)',
  },
} as const;

export const designSystemRules = [
  "One spacing scale — no arbitrary gaps or padding",
  "One typography scale — no random font sizes",
  "One radius scale — sm/md/lg/xl/full only",
  "One elevation scale — none/low/medium/high/overlay",
  "Semantic colors only — primary/success/warning/danger/neutral",
  "Hebrew RTL first — text-right, logical spacing, icon alignment checked",
  "Mobile-first — touch targets ≥ 44px",
  "Skeletons over spinners unless unavoidable",
  "Empty states reduce stress — never feel broken",
  "Motion is calm — 120–320ms, no flashy animations",
  "Customer copy never exposes engine/internal terms",
] as const;
