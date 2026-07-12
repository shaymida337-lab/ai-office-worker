/**
 * עזרי הקראה (Text-to-Speech) טהורים — ניתנים לבדיקת יחידה.
 * ההקראה מתבצעת כולה בדפדפן (Web Speech Synthesis API): שום טקסט לא
 * נשלח לשירות חיצוני על ידינו ושום אודיו לא נשמר.
 */

export type VoiceLike = { lang: string; name: string; localService?: boolean; default?: boolean };

/**
 * בחירת הקול העברי הטוב ביותר מהקולות הזמינים:
 * he-IL מדויק קודם, אחר כך כל קול he-*, ועדיפות לקול מקומי (localService).
 */
export function pickHebrewVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const hebrew = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("he"));
  if (hebrew.length === 0) return null;
  const exact = hebrew.filter((voice) => voice.lang.toLowerCase().replace("_", "-") === "he-il");
  const pool = exact.length > 0 ? exact : hebrew;
  return pool.find((voice) => voice.localService) ?? pool[0];
}

export const SYNTHESIS_FALLBACK_NOTICE =
  "בדפדפן הזה אין קול עברי מובנה — ההקראה תישמע בקול ברירת המחדל של המכשיר.";

export const SYNTHESIS_UNSUPPORTED_NOTICE =
  "הדפדפן הזה לא תומך בהקראה קולית — התשובות יוצגו כרגיל בטקסט.";
