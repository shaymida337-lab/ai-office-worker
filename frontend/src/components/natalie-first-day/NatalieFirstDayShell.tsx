"use client";

import type { ReactNode } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { ONBOARDING_TOTAL_STEPS } from "./onboardingContent";

export function NatalieFirstDayShell({
  children,
  step,
  showPortrait = false,
  portraitSize = "default",
  portraitTight = false,
  density = "default",
  hideFooter = false,
  footerCentered = false,
  hideProgress = false,
  stickyFooter,
  onBack,
  primaryLabel = "המשך",
  onPrimary,
  primaryDisabled = false,
  secondaryAction,
}: {
  children: ReactNode;
  step: number;
  showPortrait?: boolean;
  portraitSize?: "default" | "large" | "xlarge";
  portraitTight?: boolean;
  density?: "default" | "compact";
  hideFooter?: boolean;
  footerCentered?: boolean;
  hideProgress?: boolean;
  stickyFooter?: ReactNode;
  onBack?: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  secondaryAction?: ReactNode;
}) {
  const showProgress = !hideProgress && step >= 1 && step <= ONBOARDING_TOTAL_STEPS;
  const isCompact = density === "compact";
  const sectionGap = isCompact || portraitTight ? "gap-3" : "gap-4";
  const bodyGap = isCompact ? "gap-2.5 sm:gap-3" : "gap-4 sm:gap-5";

  const portraitMaxWidth =
    portraitSize === "xlarge"
      ? "max-w-[200px] sm:max-w-[220px] [@media(max-height:820px)]:max-w-[170px]"
      : portraitSize === "large"
        ? "max-w-[180px] sm:max-w-[200px] [@media(max-height:820px)]:max-w-[155px]"
        : "max-w-[160px] sm:max-w-[180px]";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-1 flex-col justify-center">
      <article
        className={`relative flex max-h-[min(calc(100svh-1.5rem),calc(100dvh-1.5rem))] w-full flex-col overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_24px_64px_-48px_rgba(15,23,42,0.2)] ${
          isCompact ? "px-4 py-4 sm:px-6 sm:py-5" : "px-5 py-5 sm:px-7 sm:py-6"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-blue-50/80 to-transparent" aria-hidden />

        <div className={`relative flex min-h-0 flex-1 flex-col ${sectionGap}`}>
          {showProgress && (
            <div className="shrink-0 grid gap-2 text-right">
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
              <ol className="flex flex-wrap justify-end gap-1" aria-label="התקדמות">
                {Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, index) => {
                  const stepNumber = index + 1;
                  const active = stepNumber === step;
                  const done = stepNumber < step;
                  return (
                    <li
                      key={stepNumber}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition sm:h-7 sm:w-7 sm:text-xs ${
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
            <div className={`mx-auto w-full shrink-0 ${portraitMaxWidth}`}>
              <NataliePortrait size="hero" showStatusDot />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            <div className={`grid min-w-0 text-right ${bodyGap}`}>{children}</div>
          </div>

          {stickyFooter && <div className="shrink-0 border-t border-slate-100 pt-3 sm:pt-4">{stickyFooter}</div>}

          {!hideFooter && (onBack || onPrimary) && (
            <div className="shrink-0 border-t border-slate-100 pt-3 sm:pt-4">
              {footerCentered ? (
                <div className="flex flex-col-reverse gap-3 sm:relative sm:min-h-[3.25rem] sm:items-center sm:justify-center">
                  {onBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3 text-base font-bold text-slate-800 transition hover:bg-slate-50 sm:absolute sm:end-0 sm:w-[8.75rem]"
                    >
                      חזרה
                    </button>
                  )}
                  {onPrimary && (
                    <NatalieFirstDayPrimaryButton
                      onClick={onPrimary}
                      disabled={primaryDisabled}
                      className="sm:min-w-[10.5rem]"
                    >
                      {primaryLabel}
                    </NatalieFirstDayPrimaryButton>
                  )}
                </div>
              ) : (
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-stretch sm:justify-between">
                  {onBack ? (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3 text-base font-bold text-slate-800 transition hover:bg-slate-50 sm:w-[8.75rem] sm:shrink-0"
                    >
                      חזרה
                    </button>
                  ) : (
                    <span className="hidden sm:block sm:w-[8.75rem] sm:shrink-0" />
                  )}
                  <div className="grid gap-3 sm:ml-auto sm:flex sm:items-center">
                    {secondaryAction}
                    {onPrimary && (
                      <NatalieFirstDayPrimaryButton onClick={onPrimary} disabled={primaryDisabled} className="sm:min-w-[10rem]">
                        {primaryLabel}
                      </NatalieFirstDayPrimaryButton>
                    )}
                  </div>
                </div>
              )}
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
  const controlClass =
    "w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-5 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-[3.25rem]";

  return (
    <label className="grid w-full gap-2 text-right">
      <span className="text-base font-bold text-slate-900 sm:text-lg">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${controlClass} py-3`}
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
  const controlClass =
    "w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-5 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 min-h-[3.25rem]";

  return (
    <label className="grid w-full gap-2 text-right">
      <span className="text-base font-bold text-slate-900 sm:text-lg">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} py-0`}
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

export function NatalieFirstDayMicrocopy({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <p className={`text-slate-600 ${compact ? "text-sm leading-7 sm:text-base" : "text-base leading-7 sm:leading-8"}`}>{children}</p>;
}

export function NatalieOnboardingChoiceCard({
  selected,
  onClick,
  icon,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-full min-h-[5.25rem] w-full flex-col items-start justify-between gap-2 rounded-2xl border p-3.5 text-right transition duration-300 hover:-translate-y-0.5 sm:min-h-[5.5rem] sm:p-4 ${
        selected
          ? "border-blue-300 bg-blue-50/80 text-blue-900 shadow-[0_8px_24px_-18px_rgba(37,99,235,0.28)]"
          : "border-slate-200/90 bg-white text-slate-800 shadow-[0_8px_30px_-20px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:shadow-[0_12px_32px_-22px_rgba(37,99,235,0.18)]"
      }`}
    >
      {selected && (
        <span
          className="absolute end-3 top-3 flex h-5 w-5 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-white"
          aria-hidden
        >
          ✓
        </span>
      )}
      {icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 sm:h-10 sm:w-10">{icon}</div>
      )}
      <span className="min-w-0 flex-1 break-words pe-1 text-sm font-semibold leading-6 sm:text-base sm:leading-7">{children}</span>
    </button>
  );
}
