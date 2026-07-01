export type ConfigValidationCheck = {
  checkId: string;
  category: "env" | "secret" | "oauth" | "database" | "deploy" | "feature_flag" | "webhook";
  description: string;
  required: boolean;
  failSafe: true;
};

export const CONFIG_VALIDATION_CHECKS: readonly ConfigValidationCheck[] = [
  check("env-required-vars", "env", "All required environment variables present", true),
  check("env-malformed-lines", "env", "No malformed .env lines", true),
  check("secret-presence", "secret", "JWT, DB, API keys present", true),
  check("oauth-redirect-urls", "oauth", "OAuth redirect URLs valid for environment", true),
  check("google-scopes", "oauth", "Google OAuth scopes sufficient", true),
  check("db-connectivity", "database", "Database reachable at startup", true),
  check("render-service-config", "deploy", "Render service config valid", false),
  check("feature-flags", "feature_flag", "Feature flags parse correctly", false),
  check("webhook-urls", "webhook", "Webhook URLs reachable (staging)", false),
];

function check(
  checkId: string,
  category: ConfigValidationCheck["category"],
  description: string,
  required: boolean,
): ConfigValidationCheck {
  return { checkId, category, description, required, failSafe: true };
}

export type ConfigValidationResult = {
  checkId: string;
  passed: boolean;
  message: string | null;
};

export function validateConfiguration(input: {
  results: ConfigValidationResult[];
}): { passed: boolean; blockers: string[]; warnings: string[] } {
  const catalog = new Map(CONFIG_VALIDATION_CHECKS.map((c) => [c.checkId, c]));
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const result of input.results) {
    const def = catalog.get(result.checkId);
    if (!result.passed) {
      if (def?.required) blockers.push(`${result.checkId}: ${result.message ?? "failed"}`);
      else warnings.push(`${result.checkId}: ${result.message ?? "failed"}`);
    }
  }

  for (const def of CONFIG_VALIDATION_CHECKS) {
    if (def.required && !input.results.some((r) => r.checkId === def.checkId)) {
      blockers.push(`${def.checkId}: not run`);
    }
  }

  return { passed: blockers.length === 0, blockers, warnings };
}

export function listConfigValidationChecks(): ConfigValidationCheck[] {
  return [...CONFIG_VALIDATION_CHECKS];
}
