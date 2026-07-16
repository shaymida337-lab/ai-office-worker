import { config } from "./config.js";

/** Safe in-app paths only — no open redirects. */
export const OAUTH_RETURN_ALLOWLIST = [
  "/onboarding",
  "/dashboard",
  "/dashboard/settings",
  "/dashboard/calendar",
  "/dashboard/invoices",
] as const;

export type OAuthReturnTarget = (typeof OAUTH_RETURN_ALLOWLIST)[number];

export function normalizeOAuthReturnTo(value: unknown): OAuthReturnTarget | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.includes("://") || trimmed.startsWith("//")) return null;
  const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "";
  if (!(OAUTH_RETURN_ALLOWLIST as readonly string[]).includes(pathOnly)) return null;
  return pathOnly as OAuthReturnTarget;
}

export function defaultOAuthReturnTarget(provider: "gmail" | "calendar"): OAuthReturnTarget {
  // ברירת המחדל אחרי חזרה מ-OAuth היא מסך הבית — לא הגדרות. מסך ספציפי
  // (הגדרות/יומן/חשבוניות) מגיע רק דרך returnTo מפורש מהמסך שממנו התחילו.
  return provider === "gmail" ? "/dashboard" : "/dashboard/calendar";
}

export function oauthIntegrationRedirect(
  provider: "gmail" | "calendar",
  status: "connected" | "invalid_state" | "error",
  returnTo: unknown,
  reason?: string
): string {
  const path = normalizeOAuthReturnTo(returnTo) ?? defaultOAuthReturnTarget(provider);
  const params = new URLSearchParams();
  params.set(provider, status);
  if (status === "error" && reason) {
    params.set("reason", reason.slice(0, 500));
  }
  return `${config.frontendUrl}${path}?${params.toString()}`;
}
