/**
 * מיפוי פרמטרי החזרה מ-OAuth (?gmail=... / ?calendar=...) להודעת משתמש בעברית.
 *
 * ה-backend מפנה חזרה עם: <provider>=connected | invalid_state | error[&reason=...]
 * (ר' backend/src/lib/oauthReturn.ts). עד תיקון זה המסך טיפל רק ב-connected —
 * שגיאות כמו token_already_bound נבלעו והמשתמש חשב שהחיבור הצליח.
 */

export type OAuthReturnTone = "success" | "error";

export type OAuthReturnMessage = {
  provider: "gmail" | "calendar";
  tone: OAuthReturnTone;
  text: string;
};

const PROVIDER_LABELS: Record<OAuthReturnMessage["provider"], string> = {
  gmail: "ג׳ימייל",
  calendar: "היומן",
};

const KNOWN_ERROR_REASONS: Record<string, (providerLabel: string) => string> = {
  token_already_bound: (label) =>
    `חשבון ה-${label} הזה כבר מחובר לארגון אחר. נתק אותו שם (הגדרות ← נתק) ונסה לחבר שוב.`,
};

export function oauthReturnMessage(search: string): OAuthReturnMessage | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const provider = (["gmail", "calendar"] as const).find((name) => params.has(name));
  if (!provider) return null;

  const status = params.get(provider);
  const label = PROVIDER_LABELS[provider];

  if (status === "connected") {
    return { provider, tone: "success", text: `${label} חובר בהצלחה!` };
  }
  if (status === "invalid_state") {
    return {
      provider,
      tone: "error",
      text: `חיבור ה-${label} פג תוקף (עברו יותר מ-10 דקות מתחילת התהליך). נסה לחבר שוב.`,
    };
  }
  if (status === "error") {
    const reason = (params.get("reason") ?? "").trim();
    const known = KNOWN_ERROR_REASONS[reason];
    if (known) return { provider, tone: "error", text: known(label) };
    return {
      provider,
      tone: "error",
      text: reason
        ? `חיבור ה-${label} נכשל: ${reason.slice(0, 160)}`
        : `חיבור ה-${label} נכשל. נסה שוב, ואם זה חוזר — פנה לתמיכה.`,
    };
  }
  return null;
}
