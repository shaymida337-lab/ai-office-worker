/**
 * שירות קול מרכזי לנטלי (Web Speech API בלבד).
 *
 * זהו המקום היחיד במערכת שבוחר קול (voice) להקראה בדפדפן:
 * - טוען את רשימת הקולות גם מיידית, גם דרך voiceschanged וגם ב-polling
 *   (בחלק מהדפדפנים voiceschanged לא נורה בכלל).
 * - בוחר קול עברי נשי לפי רשימת עדיפויות מסודרת, עם fallback מדורג.
 * - מדבר בצורה בטוחה גם במובייל: ביטול utterance קודם רק כשצריך,
 *   השהיה קצרה אחרי cancel (race ידוע באנדרואיד), resume אם paused,
 *   ודיווח כשל אמיתי (לא הצלחה מדומה) כשהדפדפן חוסם השמעה.
 *
 * אין כאן תלות ב-React — הכל ניתן לבדיקה עם synth מוזרק.
 */

export type VoiceLike = {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
};

export type UtteranceLike = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: VoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

export type SynthLike = {
  getVoices(): VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  resume(): void;
  paused?: boolean;
  speaking?: boolean;
  pending?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type VoiceMatchTier =
  | "known-female-hebrew"
  | "female-indication-hebrew"
  | "local-hebrew"
  | "any-hebrew"
  | "female-english-fallback"
  | "none";

export type VoicePick = {
  voice: VoiceLike;
  tier: VoiceMatchTier;
};

/**
 * שמות קולות עבריים נשיים מוכרים (Windows / Edge / Android / iOS / macOS).
 * ההשוואה היא case-insensitive על substring — הרשימה ניתנת להרחבה.
 */
const KNOWN_FEMALE_HEBREW_VOICE_NAMES = [
  "hila", // Microsoft Hila (Online Natural) — Edge/Windows
  "carmit", // Apple — iOS/macOS
  "google עברית", // Google network voice — Chrome
  "google hebrew",
];

/** אינדיקציה נשית כללית בשם הקול. */
const FEMALE_NAME_INDICATIONS = ["female", "woman", "נקבה", "אישה", "נשי"];

/** קולות עבריים שידוע שהם גבריים — כדי לא לסמן אותם כנשיים בטעות. */
const KNOWN_MALE_VOICE_NAMES = ["asaf", "avri", "male", "זכר", "גבר"];

/**
 * קולות אנגליים נשיים מוכרים — fallback אחרון כשאין שום קול עברי.
 * מסודרים לפי איכות/נפוצות (Windows, Android, iOS/macOS).
 */
const KNOWN_FEMALE_ENGLISH_VOICE_NAMES = [
  "aria", // Microsoft Aria (Natural)
  "jenny", // Microsoft Jenny (Natural)
  "zira", // Microsoft Zira — Windows
  "michelle",
  "samantha", // Apple
  "karen", // Apple
  "moira", // Apple
  "tessa", // Apple
  "victoria", // Apple
  "google uk english female",
  "google us english", // הקול הנשי הרגיל של Chrome
];

function nameMatches(voice: VoiceLike, needles: string[]): boolean {
  const name = voice.name.toLowerCase();
  return needles.some((needle) => name.includes(needle));
}

/** עברית מדווחת כ-he / he-IL, ובאנדרואיד ישן גם כ-iw. */
export function isHebrewVoice(voice: VoiceLike): boolean {
  const lang = (voice.lang || "").toLowerCase().replace("_", "-");
  return lang === "he" || lang.startsWith("he-") || lang === "iw" || lang.startsWith("iw-");
}

function isKnownMale(voice: VoiceLike): boolean {
  return nameMatches(voice, KNOWN_MALE_VOICE_NAMES);
}

/**
 * בחירת הקול של נטלי לפי סדר עדיפות:
 * 1. קול עברי נשי מוכר בשמו.
 * 2. קול עברי עם אינדיקציה נשית בשם.
 * 3. קול עברי מקומי (localService).
 * 4. קול עברי כלשהו.
 * 5. קול אנגלי נשי מוכר (רק אם אין עברית בכלל).
 * מחזיר null רק כשרשימת הקולות ריקה לגמרי.
 */
export function selectNatalieVoice(voices: VoiceLike[]): VoicePick | null {
  if (!voices.length) return null;

  const hebrew = voices.filter(isHebrewVoice);

  for (const needle of KNOWN_FEMALE_HEBREW_VOICE_NAMES) {
    const match = hebrew.find((voice) => voice.name.toLowerCase().includes(needle));
    if (match) return { voice: match, tier: "known-female-hebrew" };
  }

  const femaleIndicated = hebrew.find(
    (voice) => nameMatches(voice, FEMALE_NAME_INDICATIONS) && !isKnownMale(voice)
  );
  if (femaleIndicated) return { voice: femaleIndicated, tier: "female-indication-hebrew" };

  const localHebrew = hebrew.find((voice) => voice.localService === true);
  if (localHebrew) return { voice: localHebrew, tier: "local-hebrew" };

  if (hebrew.length) return { voice: hebrew[0], tier: "any-hebrew" };

  for (const needle of KNOWN_FEMALE_ENGLISH_VOICE_NAMES) {
    const match = voices.find(
      (voice) => voice.name.toLowerCase().includes(needle) && !isKnownMale(voice)
    );
    if (match) return { voice: match, tier: "female-english-fallback" };
  }

  return { voice: voices[0], tier: "none" };
}

/** שפת ה-utterance נגזרת מהקול שנבחר — לא תמיד he-IL. */
export function resolveUtteranceLang(pick: VoicePick | null): string {
  if (!pick) return "he-IL";
  if (isHebrewVoice(pick.voice)) return "he-IL";
  return pick.voice.lang || "en-US";
}

export type VoiceSelectionDiagnostics = {
  totalVoices: number;
  allVoices: Array<{ name: string; lang: string; localService: boolean; default: boolean }>;
  hebrewVoiceNames: string[];
  selectedName: string | null;
  selectedTier: VoiceMatchTier;
  selectionReason: string;
  otherHebrewVoicesExist: boolean;
  femaleIdentifiedByName: string[];
  femaleHebrewAvailable: boolean;
};

const TIER_REASONS: Record<VoiceMatchTier, string> = {
  "known-female-hebrew": "שם הקול נמצא ברשימת הקולות העבריים הנשיים המוכרים",
  "female-indication-hebrew": "שם הקול העברי מכיל אינדיקציה נשית מפורשת",
  "local-hebrew": "אין קול עברי מזוהה כנשי — נבחר קול עברי מקומי (המגדר אינו מובטח)",
  "any-hebrew": "אין קול עברי מזוהה כנשי — נבחר קול עברי כלשהו (המגדר אינו מובטח)",
  "female-english-fallback": "אין שום קול עברי במכשיר — fallback לקול אנגלי נשי מוכר",
  none: "לא נמצא שום קול מתאים — הדפדפן יבחר קול ברירת מחדל",
};

/**
 * דוח אבחון מלא על רשימת הקולות והבחירה — ללוג development בלבד ולבדיקות.
 * לא מניח ששום קול עברי הוא נשי: femaleHebrewAvailable=true רק בזיהוי לפי שם.
 */
export function buildVoiceDiagnostics(voices: VoiceLike[]): VoiceSelectionDiagnostics {
  const pick = selectNatalieVoice(voices);
  const hebrew = voices.filter(isHebrewVoice);
  const femaleIdentified = voices.filter(
    (voice) =>
      !isKnownMale(voice) &&
      (nameMatches(voice, KNOWN_FEMALE_HEBREW_VOICE_NAMES) ||
        nameMatches(voice, FEMALE_NAME_INDICATIONS) ||
        nameMatches(voice, KNOWN_FEMALE_ENGLISH_VOICE_NAMES))
  );
  const femaleHebrewAvailable = hebrew.some(
    (voice) =>
      !isKnownMale(voice) &&
      (nameMatches(voice, KNOWN_FEMALE_HEBREW_VOICE_NAMES) || nameMatches(voice, FEMALE_NAME_INDICATIONS))
  );
  return {
    totalVoices: voices.length,
    allVoices: voices.map((voice) => ({
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService === true,
      default: voice.default === true,
    })),
    hebrewVoiceNames: hebrew.map((voice) => voice.name),
    selectedName: pick?.voice.name ?? null,
    selectedTier: pick?.tier ?? "none",
    selectionReason: TIER_REASONS[pick?.tier ?? "none"],
    otherHebrewVoicesExist: hebrew.length > 1,
    femaleIdentifiedByName: femaleIdentified.map((voice) => voice.name),
    femaleHebrewAvailable,
  };
}

/**
 * ניקוי טקסט להקראה: מסיר Markdown, קישורים וסימנים טכניים,
 * ושומר עברית עם מספרים, שעות (14:30) ושמות.
 */
export function buildSpokenText(raw: string): string {
  let text = raw;

  // קישורי markdown — משאירים רק את הטקסט
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // כתובות URL ומיילים
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "");
  // בלוקים/קוד inline
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]*)`/g, "$1");
  // תגי HTML
  text = text.replace(/<[^>]+>/g, " ");
  // הדגשות וכותרות markdown
  text = text.replace(/(\*\*|__|\*|_|~~)/g, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  // תבליטים בתחילת שורה
  text = text.replace(/^\s*[-•*]\s+/gm, "");
  // תווים טכניים שאין טעם להקריא (שומרים פיסוק, מספרים ונקודתיים לשעות)
  text = text.replace(/[|#>\\{}[\]]/g, " ");
  // רווחים מיותרים
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

export type LoadVoicesOptions = {
  /** כמה זמן מקסימום להמתין לקולות (ברירת מחדל 2000ms). */
  timeoutMs?: number;
  /** מרווח polling (ברירת מחדל 200ms). */
  intervalMs?: number;
  /**
   * מתי הרשימה נחשבת "מוכנה" לסיום מוקדם. ברירת מחדל: ברגע שיש קול כלשהו.
   * ה-speaker של נטלי מעביר כאן "יש קול עברי" — כי בכרום על Windows קולות
   * הרשת של Google מדווחים לפעמים לפני הקולות המקומיים (כולל העברי),
   * ובחירה מוקדמת הייתה נופלת בטעות ל-fallback אנגלי.
   */
  readyWhen?: (voices: VoiceLike[]) => boolean;
};

/**
 * טעינת קולות אמינה: ניסיון מיידי, האזנה ל-voiceschanged ו-polling.
 * מסיימת מוקדם רק כשהרשימה "מוכנה" (readyWhen), אחרת ממתינה עד timeout
 * ומחזירה את מה שקיים. מחזירה [] רק אם אחרי ההמתנה עדיין אין קולות.
 */
export function loadVoicesWithRetry(
  synth: SynthLike,
  options: LoadVoicesOptions = {}
): Promise<VoiceLike[]> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 200;
  const readyWhen = options.readyWhen ?? ((voices: VoiceLike[]) => voices.length > 0);

  const immediate = safeGetVoices(synth);
  if (immediate.length && readyWhen(immediate)) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (voices: VoiceLike[]) => {
      if (done) return;
      done = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      synth.removeEventListener?.("voiceschanged", onVoicesChanged);
      resolve(voices);
    };

    const onVoicesChanged = () => {
      const voices = safeGetVoices(synth);
      if (voices.length && readyWhen(voices)) finish(voices);
    };

    synth.addEventListener?.("voiceschanged", onVoicesChanged);
    pollTimer = setInterval(onVoicesChanged, intervalMs);
    timeoutTimer = setTimeout(() => finish(safeGetVoices(synth)), timeoutMs);
  });
}

function safeGetVoices(synth: SynthLike): VoiceLike[] {
  try {
    return synth.getVoices() ?? [];
  } catch {
    return [];
  }
}

export type NatalieVoiceStatus = "idle" | "loading" | "speaking" | "error";

export type SpeakSuccess = {
  ok: true;
  voiceName: string | null;
  lang: string;
  tier: VoiceMatchTier;
};

export type SpeakFailureReason =
  | "unsupported"
  | "empty-text"
  | "canceled"
  | "blocked"
  | "error"
  | "no-start";

export type SpeakFailure = {
  ok: false;
  reason: SpeakFailureReason;
  errorCode?: string;
};

export type SpeakResult = SpeakSuccess | SpeakFailure;

export type SpeakOptions = {
  rate?: number;
  onEnd?: () => void;
  onStateChange?: (status: NatalieVoiceStatus) => void;
};

export type NatalieVoiceSpeakerDeps = {
  synth: SynthLike | null;
  createUtterance: (text: string) => UtteranceLike;
  /** השהיה אחרי cancel לפני speak (race באנדרואיד). ברירת מחדל 80ms. */
  cancelDelayMs?: number;
  /** כמה זמן להמתין ל-onstart לפני שמדווחים כשל. ברירת מחדל 4000ms. */
  startTimeoutMs?: number;
  loadVoicesOptions?: LoadVoicesOptions;
  isDev?: boolean;
};

export type NatalieVoiceSpeaker = {
  speak(text: string, options?: SpeakOptions): Promise<SpeakResult>;
  stop(): void;
  getStatus(): NatalieVoiceStatus;
  /** "פתיחת" speechSynthesis מתוך מחוות משתמש — utterance שקט. */
  primeInUserGesture(): void;
  /** לצורכי בדיקות/רענון: מנקה את מטמון הקולות. */
  resetVoiceCache(): void;
};

const BLOCKED_ERROR_CODES = new Set(["not-allowed", "audio-busy", "audio-hardware", "synthesis-unavailable"]);

export function createNatalieVoiceSpeaker(deps: NatalieVoiceSpeakerDeps): NatalieVoiceSpeaker {
  const {
    synth,
    createUtterance,
    cancelDelayMs = 80,
    startTimeoutMs = 4000,
    loadVoicesOptions,
  } = deps;
  const isDev = deps.isDev ?? process.env.NODE_ENV !== "production";

  let status: NatalieVoiceStatus = "idle";
  let cachedVoices: VoiceLike[] = [];
  let generation = 0;
  let activeOnStateChange: ((s: NatalieVoiceStatus) => void) | null = null;

  const logDev = (...args: unknown[]) => {
    if (isDev && typeof console !== "undefined") {
      console.log("[natalie][voice]", ...args);
    }
  };

  const setStatus = (next: NatalieVoiceStatus) => {
    status = next;
    activeOnStateChange?.(next);
  };

  // רענון מטמון בכל voiceschanged — לא דורסים רשימה מלאה בריקה,
  // ולא מחליפים רשימה שכוללת עברית ברשימה חלקית בלעדיה.
  if (synth?.addEventListener) {
    synth.addEventListener("voiceschanged", () => {
      const fresh = safeGetVoices(synth);
      if (!fresh.length) return;
      if (cachedVoices.some(isHebrewVoice) && !fresh.some(isHebrewVoice)) return;
      cachedVoices = fresh;
    });
  }

  let fullLoadCompleted = false;

  async function resolveVoices(): Promise<VoiceLike[]> {
    // המטמון טוב אם הוא כולל קול עברי, או אם כבר המתנו פעם אחת עד הסוף
    // (מכשיר בלי עברית בכלל) — אין טעם להמתין שוב בכל הקראה.
    if (cachedVoices.some(isHebrewVoice) || (fullLoadCompleted && cachedVoices.length)) {
      return cachedVoices;
    }
    if (!synth) return cachedVoices;
    const voices = await loadVoicesWithRetry(synth, {
      readyWhen: (list) => list.some(isHebrewVoice),
      ...loadVoicesOptions,
    });
    fullLoadCompleted = true;
    if (voices.length) cachedVoices = voices;
    return cachedVoices;
  }

  async function speak(rawText: string, options: SpeakOptions = {}): Promise<SpeakResult> {
    if (!synth) {
      logDev("speech synthesis unsupported");
      return { ok: false, reason: "unsupported" };
    }

    const text = buildSpokenText(rawText);
    if (!text) return { ok: false, reason: "empty-text" };

    const myGeneration = ++generation;
    activeOnStateChange = options.onStateChange ?? null;
    setStatus("loading");

    const voices = await resolveVoices();
    if (myGeneration !== generation) return { ok: false, reason: "canceled" };

    const pick = selectNatalieVoice(voices);
    const lang = resolveUtteranceLang(pick);
    if (isDev) {
      const diagnostics = buildVoiceDiagnostics(voices);
      logDev("voice diagnostics:", diagnostics);
      logDev(
        `selected: ${diagnostics.selectedName ?? "(browser default)"} | lang: ${lang} | tier: ${diagnostics.selectedTier} | reason: ${diagnostics.selectionReason}`
      );
      if (!diagnostics.femaleHebrewAvailable && diagnostics.hebrewVoiceNames.length) {
        logDev(
          "אין קול עברי נשי מזוהה במכשיר הזה. קולות עבריים זמינים:",
          diagnostics.hebrewVoiceNames.join(", ")
        );
      }
    }

    // ביטול הקראה קודמת — רק כשבאמת יש מה לבטל.
    if (synth.speaking || synth.pending) {
      try {
        synth.cancel();
      } catch {
        // cancel נכשל — ממשיכים; speak עדיין עשוי לעבוד.
      }
      // race ידוע באנדרואיד/כרום: speak מיד אחרי cancel נבלע.
      await new Promise((resolve) => setTimeout(resolve, cancelDelayMs));
      if (myGeneration !== generation) return { ok: false, reason: "canceled" };
    }

    if (synth.paused) {
      try {
        synth.resume();
      } catch {
        // resume נכשל — עדיין מנסים לדבר.
      }
    }

    const utterance = createUtterance(text);
    utterance.lang = lang;
    if (pick) utterance.voice = pick.voice;
    utterance.rate = options.rate ?? 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    return new Promise<SpeakResult>((resolve) => {
      let settled = false;
      let startTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (result: SpeakResult) => {
        if (settled) return;
        settled = true;
        if (startTimer) clearTimeout(startTimer);
        resolve(result);
      };

      utterance.onstart = () => {
        if (myGeneration !== generation) return;
        setStatus("speaking");
        settle({ ok: true, voiceName: pick?.voice.name ?? null, lang, tier: pick?.tier ?? "none" });
      };

      utterance.onend = () => {
        if (myGeneration === generation) setStatus("idle");
        options.onEnd?.();
        // onend בלי onstart (נדיר) — לא הצלחה.
        settle({ ok: false, reason: "no-start" });
      };

      utterance.onerror = (event) => {
        const code = event?.error;
        // interrupted/canceled הם תוצאה של stop יזום — לא כשל אמיתי.
        if (code === "interrupted" || code === "canceled") {
          if (myGeneration === generation) setStatus("idle");
          settle({ ok: false, reason: "canceled", errorCode: code });
          return;
        }
        logDev("speech error:", code ?? "(unknown)");
        if (myGeneration === generation) setStatus("error");
        settle({
          ok: false,
          reason: code && BLOCKED_ERROR_CODES.has(code) ? "blocked" : "error",
          errorCode: code,
        });
      };

      startTimer = setTimeout(() => {
        if (myGeneration !== generation) {
          settle({ ok: false, reason: "canceled" });
          return;
        }
        // speak לא התחיל בזמן סביר — כנראה נחסם בשקט (מובייל).
        logDev("speech did not start within", startTimeoutMs, "ms — treating as blocked");
        setStatus("error");
        try {
          synth.cancel();
        } catch {
          // מתעלמים — אין הקראה פעילה לבטל.
        }
        settle({ ok: false, reason: "no-start" });
      }, startTimeoutMs);

      try {
        synth.speak(utterance);
      } catch (err) {
        logDev("speak() threw:", err instanceof Error ? err.message : String(err));
        setStatus("error");
        settle({ ok: false, reason: "error" });
      }
    });
  }

  function stop() {
    generation += 1;
    if (synth) {
      try {
        synth.cancel();
      } catch {
        // מתעלמים — עצירה כשאין הקראה פעילה.
      }
    }
    setStatus("idle");
    activeOnStateChange = null;
  }

  function primeInUserGesture() {
    if (!synth) return;
    try {
      if (synth.paused) synth.resume();
      const unlock = createUtterance(" ");
      unlock.volume = 0;
      unlock.lang = "he-IL";
      synth.speak(unlock);
    } catch {
      // unlock הוא best-effort בלבד.
    }
  }

  return {
    speak,
    stop,
    getStatus: () => status,
    primeInUserGesture,
    resetVoiceCache: () => {
      cachedVoices = [];
      fullLoadCompleted = false;
    },
  };
}

let singleton: NatalieVoiceSpeaker | null = null;

/** ה-speaker היחיד של האפליקציה, קשור ל-window.speechSynthesis. */
export function getNatalieVoiceSpeaker(): NatalieVoiceSpeaker {
  if (singleton) return singleton;

  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined";

  singleton = createNatalieVoiceSpeaker({
    synth: supported ? (window.speechSynthesis as unknown as SynthLike) : null,
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
  });
  return singleton;
}
