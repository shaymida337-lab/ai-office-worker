/**
 * מנוע השיתוף — קישורים וטקסטים מותאמים לכל פלטפורמה.
 * כל קישור משותף נושא ?ref=share-<platform> — תשתית מוכנה לייחוס
 * "חבר מביא חבר" עתידי בלי refactor.
 */

export const SHARE_BASE_URL = "https://ai-office-worker.com";

export type SharePlatform = "whatsapp" | "facebook" | "linkedin" | "x" | "email" | "copy";

export const SHARE_TEXTS: Record<Exclude<SharePlatform, "copy" | "facebook" | "linkedin">, string> & {
  emailSubject: string;
} = {
  whatsapp: "אני בודק את נטלי — עובדת משרד מבוססת AI שמנהלת את העסק דרך שיחה פשוטה. שווה לראות 👇",
  x: "נטלי — עובדת משרד מבוססת AI לעסקים קטנים. מדברים איתה, היא עושה.",
  email: "היי,\n\nנתקלתי בנטלי — עובדת משרד מבוססת AI שמנהלת את העסק דרך שיחה פשוטה. חשבתי שיעניין אותך:",
  emailSubject: "שווה להכיר: נטלי — עובדת משרד AI לעסק",
};

export function shareUrlFor(platform: SharePlatform): string {
  return `${SHARE_BASE_URL}/?ref=share-${platform}`;
}

export function buildShareHref(platform: SharePlatform): string {
  const url = shareUrlFor(platform);
  switch (platform) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXTS.whatsapp}\n${url}`)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXTS.x)}&url=${encodeURIComponent(url)}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(SHARE_TEXTS.emailSubject)}&body=${encodeURIComponent(`${SHARE_TEXTS.email}\n${url}`)}`;
    case "copy":
      return url;
  }
}

export const SHARE_PLATFORMS: ReadonlyArray<{ platform: SharePlatform; label: string }> = [
  { platform: "whatsapp", label: "WhatsApp" },
  { platform: "facebook", label: "Facebook" },
  { platform: "linkedin", label: "LinkedIn" },
  { platform: "x", label: "X" },
  { platform: "email", label: "אימייל" },
  { platform: "copy", label: "העתקת קישור" },
];
