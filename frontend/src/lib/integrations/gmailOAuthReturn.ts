import type { GmailStatus } from "@/lib/api";

export type GmailOAuthReturnStatus = "connected" | "error" | "invalid_state";

export function parseGmailOAuthReturn(search: string): {
  status: GmailOAuthReturnStatus | null;
  reason: string | null;
} {
  const params = new URLSearchParams(search);
  const gmail = params.get("gmail");
  if (gmail !== "connected" && gmail !== "error" && gmail !== "invalid_state") {
    return { status: null, reason: null };
  }
  return { status: gmail, reason: params.get("reason") };
}

export function isGmailOAuthConnectedReturn(search: string): boolean {
  return parseGmailOAuthReturn(search).status === "connected";
}

export function isGmailOAuthErrorReturn(search: string): boolean {
  const { status } = parseGmailOAuthReturn(search);
  return status === "error" || status === "invalid_state";
}

export function gmailOAuthErrorMessage(
  reason: string | null,
  status: GmailOAuthReturnStatus
): string {
  const trimmed = reason?.trim();
  if (trimmed) return trimmed;
  if (status === "invalid_state") {
    return "חיבור Gmail נדחה — נסה שוב";
  }
  return "חיבור Gmail נכשל";
}

export function shouldHandleGmailOAuthErrorReturn(input: {
  search: string;
  alreadyHandled: boolean;
}): boolean {
  if (input.alreadyHandled) return false;
  return isGmailOAuthErrorReturn(input.search);
}

export function buildOptimisticGmailConnectedStatus(current: GmailStatus | null): GmailStatus {
  return {
    googleConfigured: current?.googleConfigured ?? true,
    connected: true,
    connectedAt: current?.connectedAt ?? new Date().toISOString(),
    reconnectRequired: current?.reconnectRequired ?? false,
    missingDriveScopes: current?.missingDriveScopes ?? [],
  };
}

export function shouldHandleGmailOAuthReturn(input: {
  search: string;
  alreadyHandled: boolean;
}): boolean {
  if (input.alreadyHandled) return false;
  return isGmailOAuthConnectedReturn(input.search);
}

export function cleanGmailOAuthReturnUrl(pathname = "/dashboard"): string {
  return pathname;
}

export type GmailOAuthReturnRefreshStep = "refresh" | "load" | "delay" | "refresh-again";

export function buildGmailOAuthReturnRefreshPlan(): GmailOAuthReturnRefreshStep[] {
  return ["refresh", "load", "delay", "refresh-again"];
}
