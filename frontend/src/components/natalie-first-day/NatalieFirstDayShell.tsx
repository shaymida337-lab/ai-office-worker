"use client";

import type { ReactNode } from "react";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";

export function NatalieFirstDayShell({
  children,
  showPortrait = false,
  kicker,
}: {
  children: ReactNode;
  showPortrait?: boolean;
  kicker?: string;
}) {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-2xl gap-8 px-4 py-8 md:py-12">
      {kicker && (
        <p className="text-center text-sm font-bold uppercase tracking-wide text-blue-600">{kicker}</p>
      )}
      {showPortrait && (
        <div className="mx-auto w-full max-w-[200px]">
          <NataliePortrait size="hero" showStatusDot />
        </div>
      )}
      <div className="grid gap-6">{children}</div>
    </div>
  );
}

export function NatalieFirstDayPrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-6 py-4 text-lg font-bold text-white shadow-[0_16px_40px_-12px_rgba(29,91,255,0.55)] transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-60"
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
      <span className="text-lg font-bold text-slate-900">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        dir="rtl"
      />
    </label>
  );
}

export function NatalieFirstDayMicrocopy({ children }: { children: ReactNode }) {
  return <p className="text-base leading-8 text-slate-600">{children}</p>;
}
