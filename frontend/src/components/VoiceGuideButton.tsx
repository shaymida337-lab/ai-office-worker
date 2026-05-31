"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Pause, Play, RotateCcw, Square } from "lucide-react";
import { API_URL, getToken } from "@/lib/api";

export function VoiceGuideButton({ text }: { text: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [browserSupported, setBrowserSupported] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [engine, setEngine] = useState<"ai" | "browser" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setBrowserSupported(typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  async function play() {
    if (speaking && paused) {
      resume();
      return;
    }

    setLoading(true);
    setMessage("");
    stop();
    try {
      const token = getToken();
      const response = await fetch(`${API_URL}/api/help/voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, speed }),
      });
      if (!response.ok) throw new Error("AI voice is unavailable");
      const blob = await response.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        setPaused(false);
      };
      audio.onerror = () => {
        setMessage("השמעה קולית אינה זמינה כרגע");
        setSpeaking(false);
        setPaused(false);
      };
      await audio.play();
      setEngine("ai");
      setSpeaking(true);
      setPaused(false);
    } catch {
      playBrowserFallback();
    } finally {
      setLoading(false);
    }
  }

  function playBrowserFallback() {
    if (!browserSupported) {
      setMessage("השמעה קולית אינה נתמכת בדפדפן הזה");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "he-IL";
    utterance.rate = speed === "slow" ? 0.78 : speed === "fast" ? 1.12 : 0.92;
    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setPaused(false);
      setMessage("השמעה קולית אינה זמינה כרגע");
    };
    window.speechSynthesis.speak(utterance);
    setEngine("browser");
    setSpeaking(true);
    setPaused(false);
    setMessage("AI voice לא מוגדר כרגע, מופעל קול דפדפן כגיבוי.");
  }

  function pause() {
    if (!speaking) return;
    if (engine === "ai") audioRef.current?.pause();
    if (engine === "browser" && browserSupported) window.speechSynthesis.pause();
    setPaused(true);
  }

  function resume() {
    if (!speaking || !paused) return;
    if (engine === "ai") void audioRef.current?.play();
    if (engine === "browser" && browserSupported) window.speechSynthesis.resume();
    setPaused(false);
  }

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    if (browserSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  return (
    <div className="voice-guide">
      <label className="voice-speed">
        קצב
        <select value={speed} onChange={(event) => setSpeed(event.target.value as "slow" | "normal" | "fast")}>
          <option value="slow">איטי</option>
          <option value="normal">רגיל</option>
          <option value="fast">מהיר</option>
        </select>
      </label>
      <button type="button" className="btn" onClick={play} disabled={loading}>
        {speaking && paused ? <Play className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        {loading ? "מכין קול..." : "השמעת הסבר קולי"}
      </button>
      <button type="button" className="btn btn-secondary px-3" onClick={pause} disabled={!speaking || paused}>
        <Pause className="h-4 w-4" />
        השהה
      </button>
      <button type="button" className="btn btn-secondary px-3" onClick={resume} disabled={!speaking || !paused}>
        <RotateCcw className="h-4 w-4" />
        המשך
      </button>
      <button type="button" className="btn btn-secondary px-3" onClick={stop} disabled={!speaking}>
        <Square className="h-4 w-4" />
        עצור
      </button>
      {engine === "ai" && <p className="text-sm text-emerald-200">מושמע קול AI איכותי בעברית.</p>}
      {message && <p className="text-sm text-amber-200">{message}</p>}
    </div>
  );
}
