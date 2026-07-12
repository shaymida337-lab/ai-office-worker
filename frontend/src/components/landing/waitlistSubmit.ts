const FS_BASE = "https://formspree.io/f/";

export type WaitlistSubmitResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "submit_failed" };

export function isWaitlistEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// שליחת הרשמה לרשימת ההמתנה. אסור להחזיר הצלחה כשאין form ID מוגדר —
// אחרת המייל של המשתמש נזרק בשקט והוא מאמין שנרשם.
export async function submitWaitlist(
  formId: string,
  data: FormData,
  fetchImpl: typeof fetch = fetch
): Promise<WaitlistSubmitResult> {
  if (!formId) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const response = await fetchImpl(`${FS_BASE}${formId}`, {
      method: "POST",
      body: data,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, reason: "submit_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "submit_failed" };
  }
}
