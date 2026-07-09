"use client";

import type { ReactNode } from "react";

export type MessageBannerTone = "success" | "error" | "warn" | "info";

const toneClasses: Record<MessageBannerTone, string> = {
  success: "border-[#059669] bg-[#ECFDF5] text-[#065F46]",
  error: "border-[#B91C1C] bg-[#FEE2E2] text-[#7F1D1D]",
  warn: "border-[#C2410C] bg-[#FFEDD5] text-[#7C2D12]",
  info: "border-[#1D4ED8] bg-[#EFF6FF] text-[#1E40AF]",
};

export function MessageBanner({
  tone,
  children,
  className = "",
}: {
  tone: MessageBannerTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`rounded-2xl border p-4 text-base font-semibold leading-7 ${toneClasses[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
