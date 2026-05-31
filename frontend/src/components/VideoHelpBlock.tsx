"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type VideoProvider = "youtube" | "vimeo" | "mp4" | "external";

function detectVideoProvider(url: string): VideoProvider {
  if (/youtu\.be|youtube\.com/i.test(url)) return "youtube";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/\.mp4(?:$|\?)/i.test(url)) return "mp4";
  return "external";
}

function toEmbedUrl(url: string, provider: VideoProvider) {
  if (provider === "youtube") {
    const id = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&enablejsapi=1` : url;
  }
  if (provider === "vimeo") {
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : url;
  }
  return url;
}

export function VideoHelpBlock({
  pageKey,
  videoUrl,
  videoTitle = "סרטון הדרכה",
}: {
  pageKey: string;
  videoUrl?: string | null;
  videoTitle?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const provider = useMemo(() => videoUrl ? detectVideoProvider(videoUrl) : null, [videoUrl]);
  const embedUrl = useMemo(() => videoUrl && provider ? toEmbedUrl(videoUrl, provider) : null, [provider, videoUrl]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: Array<{ itemType: string; itemKey: string; progress: number }> }>(`/api/help/progress?pageKey=${encodeURIComponent(pageKey)}`)
      .then((data) => {
        if (cancelled) return;
        const item = data.items.find((entry) => entry.itemType === "video" && entry.itemKey === "main");
        if (item) setProgress(item.progress);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pageKey]);

  function saveProgress(nextProgress: number, completed = nextProgress >= 95) {
    setProgress(nextProgress);
    apiFetch("/api/help/progress", {
      method: "POST",
      body: JSON.stringify({
        pageKey,
        itemType: "video",
        itemKey: "main",
        progress: nextProgress,
        completed,
        metadata: { provider },
      }),
    }).catch(() => undefined);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video?.duration) return;
    saveProgress(Math.round((video.currentTime / video.duration) * 100), false);
  }

  function changeSpeed(value: number) {
    setSpeed(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
  }

  function openFullscreen() {
    const target = videoRef.current?.parentElement;
    target?.requestFullscreen?.();
  }

  return (
    <section className="page-help-section">
      <h3>צפה בסרטון הדרכה</h3>
      {embedUrl && provider === "mp4" ? (
        <>
          <div className="page-help-video">
            <video
              ref={videoRef}
              src={embedUrl}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => saveProgress(100, true)}
            />
          </div>
          <div className="help-video-controls">
            <span>התקדמות: {progress}%</span>
            <label>
              מהירות
              <select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>
                <option value={0.75}>איטי</option>
                <option value={1}>רגיל</option>
                <option value={1.25}>מהיר</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={openFullscreen}>מסך מלא</button>
          </div>
        </>
      ) : embedUrl ? (
        <>
          <div className="page-help-video">
            <iframe
              src={embedUrl}
              title={videoTitle}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={() => progress === 0 && saveProgress(5, false)}
            />
          </div>
          <div className="help-video-controls">
            <span>וידאו מוטמע: {provider === "youtube" ? "YouTube" : provider === "vimeo" ? "Vimeo" : "קובץ חיצוני"}</span>
            <span>התקדמות צפייה: {progress}%</span>
            <button type="button" className="btn btn-secondary" onClick={() => saveProgress(100, true)}>סמן כנצפה</button>
          </div>
        </>
      ) : (
        <div className="page-help-video-placeholder">
          אין עדיין סרטון מחובר לדף הזה. המערכת מוכנה ל-YouTube, Vimeo או MP4 ברגע שמוסיפים כתובת ב-helpContent.
        </div>
      )}
    </section>
  );
}
