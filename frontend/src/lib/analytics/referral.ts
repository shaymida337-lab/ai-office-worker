"use client";

import { pushToDataLayer } from "./data-layer";

/**
 * תשתית referral (?ref= / ?ref_id=) — לכידת מקור ההפניה בנגיעה ראשונה,
 * מוכנה ל"חבר מביא חבר" עתידי. ללא PII: מזהי הפניה בלבד.
 */

const STORAGE_KEY = "natalie-referral-v1";

export type ReferralData = {
  referralSource: string | null;
  referralId: string | null;
};

export function parseReferral(search: string): ReferralData {
  const params = new URLSearchParams(search);
  const source = params.get("ref")?.trim().slice(0, 80) || null;
  const id = params.get("ref_id")?.trim().slice(0, 80) || null;
  return { referralSource: source, referralId: id };
}

export function captureReferralOnce(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const data = parseReferral(window.location.search);
    if (!data.referralSource && !data.referralId) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    pushToDataLayer({
      event: "referral_visit",
      referral_source: data.referralSource ?? undefined,
      referral_id: data.referralId ?? undefined,
    });
  } catch {
    /* storage חסום */
  }
}

export function getReferral(): ReferralData {
  if (typeof window === "undefined") return { referralSource: null, referralId: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReferralData) : { referralSource: null, referralId: null };
  } catch {
    return { referralSource: null, referralId: null };
  }
}
