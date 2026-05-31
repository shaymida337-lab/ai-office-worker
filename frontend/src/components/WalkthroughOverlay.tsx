"use client";

import { useEffect, useState } from "react";
import type { PageWalkthroughStep } from "@/config/helpContent";

type HighlightBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function WalkthroughOverlay({
  steps,
  open,
  onClose,
}: {
  steps: PageWalkthroughStep[];
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<HighlightBox | null>(null);
  const active = steps[index];

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setBox(null);
      return;
    }

    function updateBox() {
      const element = active ? document.querySelector(active.selector) : null;
      if (!element) {
        setBox(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      setBox({
        top: Math.max(8, rect.top - 8),
        left: Math.max(8, rect.left - 8),
        width: Math.min(window.innerWidth - 16, rect.width + 16),
        height: Math.min(window.innerHeight - 16, rect.height + 16),
      });
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }

    updateBox();
    window.addEventListener("resize", updateBox);
    window.addEventListener("scroll", updateBox, true);
    return () => {
      window.removeEventListener("resize", updateBox);
      window.removeEventListener("scroll", updateBox, true);
    };
  }, [active, open]);

  if (!open || !active) return null;

  const viewportWidth = typeof window === "undefined" ? 390 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 844 : window.innerHeight;
  const popoverStyle = box
    ? {
        top: Math.min(viewportHeight - 220, box.top + box.height + 14),
        left: Math.min(viewportWidth - 330, Math.max(12, box.left)),
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="walkthrough-layer" role="dialog" aria-modal="true" aria-label="הדרכה מודרכת">
      {box && <div className="walkthrough-highlight" style={box} />}
      <div className="walkthrough-card" style={popoverStyle}>
        <div className="text-sm text-ink-muted">שלב {index + 1} מתוך {steps.length}</div>
        <h3>{active.title}</h3>
        <p>{active.text}</p>
        <div className="walkthrough-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>הקודם</button>
          {index < steps.length - 1 ? (
            <button type="button" className="btn" onClick={() => setIndex((value) => value + 1)}>הבא</button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>סיום</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
