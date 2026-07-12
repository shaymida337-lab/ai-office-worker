"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  extractTranscripts,
  getSpeechRecognitionCtor,
  mapSpeechErrorToKind,
  type SpeechErrorKind,
  type SpeechRecognitionLike,
} from "./speechSupport";

export type UseSpeechToTextOptions = {
  lang?: string;
  onFinalTranscript: (text: string) => void;
  onEvent?: (event: "start" | "success" | "error" | "denied") => void;
};

/**
 * זיהוי דיבור דפדפני (Web Speech API) לדמו הציבורי.
 * האודיו מטופל על ידי הדפדפן בלבד — לא נשמר ולא נשלח לשרתי נטלי.
 */
export function useSpeechToText({ lang = "he-IL", onFinalTranscript, onEvent }: UseSpeechToTextOptions) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechErrorKind | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const gotResultRef = useRef(false);
  const callbacksRef = useRef({ onFinalTranscript, onEvent });
  callbacksRef.current = { onFinalTranscript, onEvent };

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor(window as unknown as Record<string, unknown>) !== null);
    return () => {
      // ניקוי ב-unmount: ביטול האזנה פעילה ושחרור ה-listeners.
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          /* הדפדפן כבר סגר את הסשן */
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* אין סשן פעיל */
    }
  }, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return; // הקלטה כבר פעילה — אין הקלטה כפולה
    const Ctor = getSpeechRecognitionCtor(window as unknown as Record<string, unknown>);
    if (!Ctor) {
      setSupported(false);
      setError("unsupported");
      callbacksRef.current.onEvent?.("error");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    gotResultRef.current = false;

    recognition.onresult = (event) => {
      const { finalText, interimText } = extractTranscripts(event);
      setInterim(interimText);
      if (finalText) {
        gotResultRef.current = true;
        callbacksRef.current.onFinalTranscript(finalText);
      }
    };

    recognition.onerror = (event) => {
      const kind = mapSpeechErrorToKind(event.error);
      setError(kind);
      callbacksRef.current.onEvent?.(kind === "denied" ? "denied" : "error");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      if (gotResultRef.current) callbacksRef.current.onEvent?.("success");
    };

    recognitionRef.current = recognition;
    setError(null);
    setInterim("");
    setListening(true);
    callbacksRef.current.onEvent?.("start");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("generic");
      callbacksRef.current.onEvent?.("error");
    }
  }, [lang]);

  const clearError = useCallback(() => setError(null), []);

  return { supported, listening, interim, error, start, stop, clearError };
}
