export type PublicHealthResponse = {
  status: string;
  database: string;
  commit?: string | null;
  version?: string;
  deployId?: string | null;
  buildTime?: string | null;
};

export type SystemDeployStatus =
  | { state: "checking" }
  | { state: "ok"; backendCommit: string | null }
  | { state: "backend_unreachable" }
  | { state: "backend_unhealthy"; database?: string }
  | { state: "commit_mismatch"; frontendCommit: string; backendCommit: string };

export function commitsAligned(
  frontendCommit: string | null | undefined,
  backendCommit: string | null | undefined
): boolean {
  if (!frontendCommit?.trim() || !backendCommit?.trim()) return true;
  const a = frontendCommit.trim().toLowerCase();
  const b = backendCommit.trim().toLowerCase();
  if (a === b) return true;
  const short = Math.min(7, a.length, b.length);
  return a.slice(0, short) === b.slice(0, short);
}

export function resolveSystemDeployStatus(input: {
  health: PublicHealthResponse | null;
  healthOk: boolean;
  frontendCommit: string | null;
}): SystemDeployStatus {
  if (!input.health) {
    return { state: "backend_unreachable" };
  }
  if (!input.healthOk || input.health.status !== "ok" || input.health.database !== "connected") {
    return { state: "backend_unhealthy", database: input.health.database };
  }
  const backendCommit = input.health.commit ?? null;
  if (!commitsAligned(input.frontendCommit, backendCommit)) {
    return {
      state: "commit_mismatch",
      frontendCommit: input.frontendCommit ?? "unknown",
      backendCommit: backendCommit ?? "unknown",
    };
  }
  return { state: "ok", backendCommit };
}

export function systemDeployBannerMessage(status: SystemDeployStatus): string | null {
  switch (status.state) {
    case "ok":
    case "checking":
      return null;
    case "backend_unreachable":
    case "backend_unhealthy":
    case "commit_mismatch":
      return "יש עדכון מערכת שלא הושלם — אנחנו מטפלים בזה";
    default:
      return null;
  }
}

export function systemDeployOkMessage(status: SystemDeployStatus): string | null {
  return status.state === "ok" ? "המערכת תקינה" : null;
}

export function getFrontendCommit(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_COMMIT?.trim();
  return value || null;
}
