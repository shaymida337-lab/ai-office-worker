/**
 * עזרי הקראה (Text-to-Speech) טהורים — ניתנים לבדיקת יחידה.
 * ההקראה מתבצעת כולה בדפדפן (Web Speech Synthesis API): שום טקסט לא
 * נשלח לשירות חיצוני על ידינו ושום אודיו לא נשמר.
 */

export type VoiceLike = { lang: string; name: string; localService?: boolean; default?: boolean };

// שמות קולות עבריים מוכרים לפי מגדר (Apple: Carmit; Microsoft: Hila נשי,
// Asaf/Avri גברי) + טוקנים גנריים שדפדפנים מוסיפים לשם הקול.
const FEMALE_TOKENS = ["carmit", "hila", "כרמית", "הילה", "female", "אישה", "נקבה"];
const MALE_TOKENS = ["asaf", "avri", "אסף", "אברי", "male", "גבר", "זכר"];

export function classifyVoiceGender(name: string): "female" | "male" | "unknown" {
  const lower = name.toLowerCase();
  if (FEMALE_TOKENS.some((token) => lower.includes(token))) return "female";
  if (MALE_TOKENS.some((token) => lower.includes(token))) return "male";
  return "unknown";
}

/**
 * בחירת הקול העברי הטוב ביותר — נטלי היא דמות נשית, לכן:
 * קול נשי מזוהה → קול לא-מזוהה → קול גברי (fallback ברור ודטרמיניסטי);
 * בתוך כל דרגה: he-IL מדויק לפני he גנרי, וקול מקומי לפני מרוחק.
 */
export function pickHebrewVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const hebrew = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("he"));
  if (hebrew.length === 0) return null;
  const genderRank = { female: 0, unknown: 1, male: 2 } as const;
  const score = (voice: T) =>
    genderRank[classifyVoiceGender(voice.name)] * 4 +
    (voice.lang.toLowerCase().replace("_", "-") === "he-il" ? 0 : 2) +
    (voice.localService ? 0 : 1);
  return [...hebrew].sort((a, b) => score(a) - score(b))[0];
}

/** האם נמצא קול נשי עברי מזוהה בין הקולות. */
export function hasHebrewFemaleVoice(voices: readonly VoiceLike[]): boolean {
  return voices.some(
    (voice) => voice.lang?.toLowerCase().startsWith("he") && classifyVoiceGender(voice.name) === "female"
  );
}

export const SYNTHESIS_FEMALE_FALLBACK_NOTICE =
  "במכשיר הזה אין קול נשי בעברית — נטלי תוקרא בקול העברי הזמין.";

export const SYNTHESIS_FALLBACK_NOTICE =
  "בדפדפן הזה אין קול עברי מובנה — ההקראה תישמע בקול ברירת המחדל של המכשיר.";

export const SYNTHESIS_UNSUPPORTED_NOTICE =
  "הדפדפן הזה לא תומך בהקראה קולית — התשובות יוצגו כרגיל בטקסט.";
