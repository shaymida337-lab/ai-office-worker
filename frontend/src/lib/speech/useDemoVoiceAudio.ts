"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

/**
 * נגינת הקול של נטלי בדמו הציבורי — האודיו מגיע מ-endpoint ייעודי בשרת
 * שמשתמש באותו קול נשי של האפליקציה. אין fallback לקול דפדפן (גברי):
 * אם השירות לא זמין — הדמו נשאר טקסטואלי עם הודעה עדינה.
 */
export function useDemoVoiceAudio() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCacheRef = useRef(new Map<string, string>());
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const urlCache = urlCacheRef.current;
    return () => {
      // עצירה ושחרור ב-unmount/ניווט
      audioRef.current?.pause();
      audioRef.current = null;
      for (const url of urlCache.values()) URL.revokeObjectURL(url);
      urlCache.clear();
    };
  }, []);

  const stop = useCallback(() => {
    requestSeqRef.current += 1; // מבטל גם fetch שבדרך
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const play = useCallback(
    async (id: string) => {
      // מניעת חפיפה: כל נגינה חדשה עוצרת את הקודמת
      audioRef.current?.pause();
      audioRef.current = null;
      const seq = (requestSeqRef.current += 1);
      setPlayingId(id);

      try {
        let url = urlCacheRef.current.get(id) ?? null;
        if (!url) {
          const response = await fetch(`${API_URL}/api/public/demo-voice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          if (!response.ok) throw new Error(`demo-voice ${response.status}`);
          const blob = await response.blob();
          if (seq !== requestSeqRef.current) return; // בוטל בינתיים
          url = URL.createObjectURL(blob);
          urlCacheRef.current.set(id, url);
        }
        if (seq !== requestSeqRef.current) return;

        const audio = new Audio(url);
        audio.onended = () => setPlayingId((current) => (current === id ? null : current));
        audio.onerror = () => setPlayingId((current) => (current === id ? null : current));
        audioRef.current = audio;
        await audio.play();
      } catch {
        if (seq !== requestSeqRef.current) return;
        // כשל שירות/נגינה — טקסט בלבד, בלי fallback לקול דפדפן.
        setUnavailable(true);
        setPlayingId(null);
      }
    },
    []
  );

  const toggle = useCallback(
    (id: string) => {
      if (playingId === id) stop();
      else void play(id);
    },
    [playingId, play, stop]
  );

  return { playingId, unavailable, play, stop, toggle };
}
