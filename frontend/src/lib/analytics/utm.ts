"use client";

/**
 * לכידת UTM בנגיעה-ראשונה: נשמר ב-sessionStorage בביקור הראשון ומצורף
 * לליד ולאירועי analytics. ללא PII — פרמטרי קמפיין ונתיב נחיתה בלבד.
 */

const STORAGE_KEY = "natalie-utm-v1";

export type UtmData = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPath: string | null;
};

export function captureUtmOnce(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const data: UtmData = {
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      landingPath: window.location.pathname + window.location.search,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage חסום — ממשיכים בלי UTM */
  }
}

export function getUtm(): UtmData {
  if (typeof window === "undefined") {
    return { source: null, medium: null, campaign: null, landingPath: null };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { source: null, medium: null, campaign: null, landingPath: null };
    return JSON.parse(raw) as UtmData;
  } catch {
    return { source: null, medium: null, campaign: null, landingPath: null };
  }
}

/** פרמטרי UTM לצירוף לאירועי analytics (רק שדות שקיימים). */
export function utmEventParams(): Record<string, string> {
  const utm = getUtm();
  const params: Record<string, string> = {};
  if (utm.source) params.source = utm.source;
  if (utm.medium) params.medium = utm.medium;
  if (utm.campaign) params.campaign = utm.campaign;
  return params;
}
