"use client";

import { useState } from "react";
import type { OnboardingStepId } from "@/lib/natalie/firstDay";

const STEPS: OnboardingStepId[] = [1, 2, 3, 4, 5, 6];

export function OnboardingDebugToolbar({
  currentStep,
  onGoToStep,
  onReset,
  onRestart,
}: {
  currentStep: OnboardingStepId;
  onGoToStep: (step: OnboardingStepId) => void;
  onReset: () => void;
  onRestart: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      className="fixed bottom-4 start-4 z-[100] max-w-[calc(100vw-2rem)] rounded-xl border border-dashed border-amber-400/80 bg-amber-50/95 p-2 text-xs text-amber-950 shadow-lg backdrop-blur-sm"
      dir="ltr"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-bold">Onboarding DEV</span>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold hover:bg-amber-100"
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed && (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1">
            {STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => onGoToStep(step)}
                className={`rounded-md px-2 py-1 font-semibold transition ${
                  currentStep === step ? "bg-amber-600 text-white" : "bg-white text-amber-900 hover:bg-amber-100"
                }`}
              >
                Step {step}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold hover:bg-amber-100"
            >
              Reset progress
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold hover:bg-amber-100"
            >
              Restart step 1
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
