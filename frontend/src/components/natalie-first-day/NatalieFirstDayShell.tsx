"use client";

import type { ReactNode } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { ONBOARDING_TOTAL_STEPS } from "./onboardingContent";

export function NatalieFirstDayShell({
  children,
  step,
  showPortrait = false,
  portraitSize = "default",
  hideFooter = false,
  onBack,
  primaryLabel = "המשך",
  onPrimary,
  primaryDisabled = false,
  secondaryAction,
}: {
  children: ReactNode;
  step: number;
  showPortrait?: boolean;
  portraitSize?: "default" | "large";
  hideFooter?: boolean;
  onBack?: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  secondaryAction?: ReactNode;
}) {
  const showProgress = step >= 1 && step <= ONBOARDING_TOTAL_STEPS;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-2xl gap-6 px-4 py-8 sm:px-6 md:py-10 lg:py-12">
      <article className="relative overflow-visible rounded-[1.75rem] border border-slate-200/80 bg-white px-5 py-8 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.2)] transition-all duration-500 sm:px-8 md:py-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-blue-50/80 to-transparent" aria-hidden />

        <div className="relative grid gap-6">
          {showProgress && (
            <div className="grid gap-3 text-right">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-blue-700">
                  שלב {step} מתוך {ONBOARDING_TOTAL_STEPS}
                </span>
                <span className="text-xs font-semibold text-slate-500">{Math.round((step / ONBOARDING_TOTAL_STEPS) * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-blue-600 to-indigo-500 transition-all duration-500 ease-out"
                  style={{ width: `${(step / ONBOARDING_TOTAL_STEPS) * 100}%` }}
                />
              </div>
              <ol className="flex flex-wrap justify-end gap-1.5" aria-label="התקדמות">
                {Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, index) => {
                  const stepNumber = index + 1;
                  const active = stepNumber === step;
                  const done = stepNumber < step;
                  return (
                    <li
                      key={stepNumber}
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
                        active
                          ? "bg-blue-600 text-white shadow-sm"
                          : done
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                      aria-current={active ? "step" : undefined}
                    >
                      {done ? "✓" : stepNumber}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {showPortrait && (
            <div className={`mx-auto w-full ${portraitSize === "large" ? "max-w-[240px]" : "max-w-[180px]"}`}>
              <NataliePortrait size="hero" showStatusDot />
            </div>
          )}

          <div className="grid min-w-0 gap-5 text-right">{children}</div>

          {!hideFooter && (onBack || onPrimary) && (
            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3 text-base font-bold text-slate-800 transition hover:bg-slate-50"
                >
                  חזרה
                </button>
              ) : (
                <span className="hidden sm:block" />
              )}
              <div className="grid gap-3 sm:ml-auto sm:flex sm:items-center">
                {secondaryAction}
                {onPrimary && (
                  <NatalieFirstDayPrimaryButton onClick={onPrimary} disabled={primaryDisabled}>
                    {primaryLabel}
                  </NatalieFirstDayPrimaryButton>
                )}
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

export function NatalieFirstDayPrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-6 py-3.5 text-base font-bold text-white shadow-[0_12px_32px_-12px_rgba(29,91,235,0.55)] transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-60 sm:min-w-[10rem] sm:w-auto ${className}`}
    >
      {children}
    </button>
  );
}

export function NatalieFirstDaySecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3.5 text-base font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60 sm:min-w-[10rem] sm:w-auto"
    >
      {children}
    </button>
  );
}

export function NatalieFirstDayField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-right">
      <span className="text-base font-bold text-slate-900 sm:text-lg">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        dir="rtl"
      />
    </label>
  );
}

export function NatalieFirstDaySelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-2 text-right">
      <span className="text-base font-bold text-slate-900 sm:text-lg">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        dir="rtl"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NatalieFirstDayMicrocopy({ children }: { children: ReactNode }) {
  return <p className="text-base leading-8 text-slate-600">{children}</p>;
}

export function NatalieOnboardingChoiceCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-right text-base font-semibold transition duration-300 hover:-translate-y-0.5 ${
        selected
          ? "border-blue-400 bg-blue-50 text-blue-900 shadow-[0_8px_24px_-16px_rgba(37,99,235,0.35)]"
          : "border-slate-200/90 bg-white text-slate-800 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.15)] hover:border-blue-200"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
          selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent"
        }`}
        aria-hidden
      >
        ✓
      </span>
      <span className="min-w-0 flex-1 break-words leading-7">{children}</span>
    </button>
  );
}
