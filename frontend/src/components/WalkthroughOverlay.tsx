"use client";

import { useEffect, useState } from "react";
import type { PageWalkthroughStep } from "@/config/helpContent";
import { apiFetch } from "@/lib/api";

type HighlightBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function WalkthroughOverlay({
  pageKey,
  steps,
  open,
  onClose,
}: {
  pageKey: string;
  steps: PageWalkthroughStep[];
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<HighlightBox | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const active = steps[index];

  useEffect(() => {
    if (!open) {
      setIndex(0);
      setBox(null);
      setCompletedSteps(new Set());
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

  useEffect(() => {
    if (!open || !active?.requiredAction) return;
    function onDocumentClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(active.selector)) {
        setCompletedSteps((previous) => new Set(previous).add(index));
      }
    }
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [active, index, open]);

  if (!open || !active) return null;

  const viewportWidth = typeof window === "undefined" ? 390 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 844 : window.innerHeight;
  const popoverStyle = box
    ? {
        top: Math.min(viewportHeight - 220, box.top + box.height + 14),
        left: Math.min(viewportWidth - 330, Math.max(12, box.left)),
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const stepDone = !active.requiredAction || completedSteps.has(index);
  const progress = Math.round(((index + (stepDone ? 1 : 0)) / steps.length) * 100);

  function markStepDone() {
    setCompletedSteps((previous) => new Set(previous).add(index));
  }

  function saveTrainingProgress(completed: boolean) {
    apiFetch("/api/help/progress", {
      method: "POST",
      body: JSON.stringify({
        pageKey,
        itemType: "training",
        itemKey: "full",
        progress: completed ? 100 : progress,
        completed,
        metadata: { stepIndex: index, stepTitle: active.title },
      }),
    }).catch(() => undefined);
  }

  function nextStep() {
    saveTrainingProgress(false);
    setIndex((value) => value + 1);
  }

  function finish() {
    saveTrainingProgress(true);
    onClose();
  }

  return (
    <div className="walkthrough-layer" role="dialog" aria-modal="true" aria-label="הדרכה מודרכת">
      {box && <div className="walkthrough-highlight" style={box} />}
      <div className="walkthrough-card" style={popoverStyle}>
        <div className="text-sm text-ink-muted">שלב {index + 1} מתוך {steps.length}</div>
        <h3>{active.title}</h3>
        <p>{active.text}</p>
        {active.requiredAction && (
          <div className={stepDone ? "walkthrough-step-done" : "walkthrough-step-required"}>
            {stepDone ? "השלב הושלם. אפשר להמשיך." : active.actionText ?? "לחץ על האזור המסומן כדי להשלים את השלב."}
          </div>
        )}
        <div className="walkthrough-progress" aria-label={`התקדמות ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="walkthrough-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>הקודם</button>
          {active.requiredAction && !stepDone && (
            <button type="button" className="btn btn-secondary" onClick={markStepDone}>סימנתי שבוצע</button>
          )}
          {index < steps.length - 1 ? (
            <button type="button" className="btn" onClick={nextStep} disabled={!stepDone}>הבא</button>
          ) : (
            <button type="button" className="btn" onClick={finish} disabled={!stepDone}>סיום</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}
