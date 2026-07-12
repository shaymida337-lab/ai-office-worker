"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasHebrewFemaleVoice, pickHebrewVoice } from "./speechSynthesisSupport";

/**
 * הקראת טקסט בדפדפן (Web Speech Synthesis) לדמו הציבורי.
 * - אין חפיפה: כל הקראה חדשה מבטלת את הקודמת.
 * - ביטול מלא ב-unmount (וכך גם בניווט בין עמודים).
 * - עברית he-IL עם fallback לקול ברירת המחדל כשאין קול עברי.
 */
export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(true);
  const [hebrewVoiceMissing, setHebrewVoiceMissing] = useState(false);
  const [femaleVoiceMissing, setFemaleVoiceMissing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
      setSupported(false);
      return;
    }
    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length === 0) return; // הקולות עוד נטענים
      const hebrew = pickHebrewVoice(voices);
      voiceRef.current = hebrew;
      setHebrewVoiceMissing(hebrew === null);
      setFemaleVoiceMissing(hebrew !== null && !hasHebrewFemaleVoice(voices));
    };
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
    return () => {
      synth.removeEventListener?.("voiceschanged", loadVoices);
      synth.cancel(); // ביטול הקראה פעילה ב-unmount/ניווט
    };
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, text: string) => {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
      setSupported(false);
      return;
    }
    synth.cancel(); // מניעת חפיפה בין שתי הקראות
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "he-IL";
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
    utterance.onerror = () => setSpeakingId((current) => (current === id ? null : current));
    setSpeakingId(id);
    try {
      synth.speak(utterance);
    } catch {
      // דפדפן שזרק על speak — לא מפילים את הדמו, פשוט חוזרים למצב רגיל.
      setSpeakingId((current) => (current === id ? null : current));
    }
  }, []);

  const toggle = useCallback(
    (id: string, text: string) => {
      if (speakingId === id) stop();
      else speak(id, text);
    },
    [speakingId, speak, stop]
  );

  return { supported, hebrewVoiceMissing, femaleVoiceMissing, speakingId, speak, stop, toggle };
}
