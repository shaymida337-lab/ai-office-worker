export const DASHBOARD_GMAIL_SYNC_ENDPOINT = "/api/gmail/scan";

export type DashboardSyncRetryRequest = {
  method: "POST";
  path: typeof DASHBOARD_GMAIL_SYNC_ENDPOINT;
  body?: Record<string, unknown>;
};

export function createDashboardSyncRetryRequest(daysBack?: number): DashboardSyncRetryRequest {
  return {
    method: "POST",
    path: DASHBOARD_GMAIL_SYNC_ENDPOINT,
    ...(daysBack != null ? { body: { daysBack } } : {}),
  };
}

export function isDashboardSyncRetryRequest(input: { method: string; path: string }): boolean {
  return input.method === "POST" && input.path === DASHBOARD_GMAIL_SYNC_ENDPOINT;
}
