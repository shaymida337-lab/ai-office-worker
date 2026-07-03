import type {
  NatalieCoreClassifiedError,
  NatalieCoreErrorCategory,
  NatalieCoreErrorSeverity,
} from "./coreTypes.js";

type ClassifyErrorInput = {
  userFacing?: boolean;
  subsystem?: string | null;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as { status?: unknown; response?: { status?: unknown } };
  const status = candidate.status ?? candidate.response?.status;
  return typeof status === "number" ? status : null;
}

function classifyCategory(err: unknown): NatalieCoreErrorCategory {
  const message = errorMessage(err).toLowerCase();
  const code = (errorCode(err) ?? "").toLowerCase();
  const status = errorStatus(err);

  if (code.includes("timeout") || message.includes("timeout") || message.includes("etimedout")) {
    return "timeout";
  }
  if (status === 401 || status === 403 || code.includes("auth") || message.includes("unauthorized")) {
    return "auth";
  }
  if (status === 429 || message.includes("rate limit")) {
    return "rate_limit";
  }
  if (status != null && status >= 500) {
    return "external_service";
  }
  if (status != null && status >= 400 && status < 500) {
    return "validation";
  }
  if (
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("fetch failed")
  ) {
    return "network";
  }
  if (err instanceof Error) return "internal";
  return "unknown";
}

function classifySeverity(category: NatalieCoreErrorCategory, recoverable: boolean): NatalieCoreErrorSeverity {
  if (category === "auth") return "high";
  if (category === "rate_limit") return "medium";
  if (category === "timeout" || category === "network") return recoverable ? "medium" : "high";
  if (category === "validation") return "low";
  if (category === "external_service") return "high";
  if (category === "internal") return "critical";
  return "medium";
}

function recommendedAction(
  category: NatalieCoreErrorCategory,
  recoverable: boolean
): string {
  switch (category) {
    case "auth":
      return "reconnect_integration";
    case "timeout":
    case "network":
      return recoverable ? "retry" : "check_connectivity";
    case "rate_limit":
      return "backoff_and_retry";
    case "validation":
      return "fix_input";
    case "external_service":
      return recoverable ? "retry_later" : "escalate";
    case "internal":
      return "escalate";
    default:
      return recoverable ? "retry" : "review_logs";
  }
}

function isRecoverable(category: NatalieCoreErrorCategory, status: number | null): boolean {
  if (category === "auth" || category === "validation") return false;
  if (category === "rate_limit" || category === "timeout" || category === "network") return true;
  if (status != null && status >= 500) return true;
  return category === "external_service";
}

export function classifyCoreError(err: unknown, input: ClassifyErrorInput = {}): NatalieCoreClassifiedError {
  const category = classifyCategory(err);
  const status = errorStatus(err);
  const recoverable = isRecoverable(category, status);
  const severity = classifySeverity(category, recoverable);
  const userVisible = Boolean(input.userFacing) || category === "auth" || category === "validation";

  return {
    category,
    severity,
    recoverable,
    userVisible,
    recommendedAction: recommendedAction(category, recoverable),
    message: errorMessage(err),
    code: errorCode(err),
  };
}
