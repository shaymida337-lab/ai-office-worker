/**
 * עזרי זיהוי-דיבור טהורים (ללא React) — ניתנים לבדיקת יחידה.
 * התמלול מתבצע כולו על ידי הדפדפן (Web Speech API): הקוד שלנו לא נוגע
 * באודיו, לא שומר אותו ולא שולח אותו לשרתי נטלי.
 */

export type SpeechErrorKind = "denied" | "no-speech" | "unsupported" | "generic";

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export function getSpeechRecognitionCtor(
  target: Record<string, unknown> | undefined
): SpeechRecognitionCtor | null {
  if (!target) return null;
  const ctor = target.SpeechRecognition ?? target.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

export function mapSpeechErrorToKind(code: string | undefined): SpeechErrorKind {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
    case "audio-capture":
      return "no-speech";
    default:
      return "generic";
  }
}

export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  denied: "כדי לדבר עם נטלי צריך לאשר גישה למיקרופון בדפדפן. אפשר כמובן גם להקליד 🙂",
  "no-speech": "לא שמעתי כלום — נסו שוב, קצת יותר קרוב למיקרופון.",
  unsupported: "הדפדפן הזה עדיין לא תומך בזיהוי דיבור — אפשר להקליד כרגיל.",
  generic: "התמלול לא הצליח הפעם. נסו שוב או המשיכו בהקלדה.",
};

/** מחלץ תמלול סופי ותמלול-ביניים מאירוע תוצאה. */
export function extractTranscripts(event: SpeechResultEventLike): {
  finalText: string;
  interimText: string;
} {
  let finalText = "";
  let interimText = "";
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i];
    const transcript = result[0]?.transcript ?? "";
    if (result.isFinal) finalText += transcript;
    else interimText += transcript;
  }
  return { finalText: finalText.trim(), interimText: interimText.trim() };
}

/** צירוף תמלול לטקסט קיים בשדה — בלי לדרוס מה שהמשתמש כבר כתב. */
export function appendTranscript(existing: string, transcript: string): string {
  const clean = transcript.trim();
  if (!clean) return existing;
  const base = existing.trimEnd();
  return base ? `${base} ${clean}` : clean;
}
