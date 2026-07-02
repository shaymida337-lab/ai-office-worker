import type { GmailStatus } from "@/lib/api";

export function isGmailOAuthConnectedReturn(search: string): boolean {
  return new URLSearchParams(search).get("gmail") === "connected";
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
