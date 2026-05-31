"use client";

import { useEffect, useState } from "react";
import { Headphones, Pause, Play, Square } from "lucide-react";

export function VoiceGuideButton({ text }: { text: string }) {
  const [supported, setSupported] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function play() {
    if (!supported) {
      setMessage("השמעה קולית אינה נתמכת בדפדפן הזה");
      return;
    }
    if (speaking && paused) {
      window.speechSynthesis.resume();
      setPaused(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "he-IL";
    utterance.rate = 0.95;
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
    setSpeaking(true);
    setPaused(false);
    setMessage("");
  }

  function pause() {
    if (!supported || !speaking) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }

  function stop() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }

  return (
    <div className="voice-guide">
      <button type="button" className="btn" onClick={play}>
        {speaking && paused ? <Play className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        השמעת הסבר קולי
      </button>
      <button type="button" className="btn btn-secondary px-3" onClick={pause} disabled={!speaking || paused}>
        <Pause className="h-4 w-4" />
        השהה
      </button>
      <button type="button" className="btn btn-secondary px-3" onClick={stop} disabled={!speaking}>
        <Square className="h-4 w-4" />
        עצור
      </button>
      {message && <p className="text-sm text-amber-200">{message}</p>}
    </div>
  );
}
