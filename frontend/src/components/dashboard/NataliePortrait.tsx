"use client";

import Image from "next/image";
import { useState } from "react";
import { colors, radius } from "@/lib/design-tokens";

const PORTRAIT_SRC = "/natalie-portrait.png";

export function NataliePortrait({
  className = "",
  size = "default",
  showStatusDot = false,
}: {
  className?: string;
  size?: "default" | "hero" | "heroDesktop" | "avatar" | "compact" | "micro";
  showStatusDot?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  const sizeClass =
    size === "micro"
      ? "h-11 w-11 shrink-0 rounded-full"
      : size === "compact"
        ? "h-14 w-14 shrink-0 rounded-full sm:h-16 sm:w-16"
        : size === "avatar"
          ? "h-[72px] w-[72px] shrink-0 rounded-full md:h-[88px] md:w-[88px]"
          : size === "heroDesktop"
            ? "h-[220px] w-[176px] shrink-0"
            : size === "hero"
              ? "aspect-[4/5] w-full max-w-[360px] md:max-w-[300px]"
              : "aspect-[3/4] w-full max-w-[220px]";

  const isRound = size === "avatar" || size === "compact" || size === "micro";

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`relative overflow-hidden ${isRound ? sizeClass : `${radius.lg} ${sizeClass}`}`}
        style={{
          boxShadow: isRound ? "0 2px 10px rgba(15,23,42,0.07)" : "0 12px 32px rgba(15,23,42,0.08)",
          border: `1px solid ${colors.borderSubtle}`,
          backgroundColor: colors.surface,
        }}
      >
        {!imageError ? (
          <Image
            src={PORTRAIT_SRC}
            alt="נטלי"
            fill
            priority={isRound}
            className="object-cover object-top"
            sizes={size === "micro" ? "44px" : size === "compact" ? "64px" : isRound ? "88px" : size === "heroDesktop" ? "176px" : "(max-width: 768px) 180px, 300px"}
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${isRound ? "" : "flex-col justify-end p-6"}`}
            style={{
              backgroundColor: colors.surface,
              background: isRound
                ? undefined
                : `linear-gradient(165deg, ${colors.accentSoft} 0%, #E0E7FF 45%, ${colors.surface} 100%)`,
            }}
          >
            {isRound ? (
              <span className={`font-extrabold ${size === "micro" ? "text-sm" : "text-xl sm:text-2xl"}`} style={{ color: colors.accent }} aria-hidden>
                נ
              </span>
            ) : (
              <>
                <div
                  className="mb-4 grid h-28 w-28 place-items-center rounded-full"
                  style={{
                    background: `linear-gradient(135deg, ${colors.accent} 0%, #6D28D9 100%)`,
                    boxShadow: "0 12px 32px rgba(29,91,255,0.25)",
                  }}
                  aria-hidden
                >
                  <svg viewBox="0 0 64 64" className="h-16 w-16 text-white" fill="currentColor">
                    <circle cx="32" cy="22" r="12" opacity="0.95" />
                    <path d="M12 58c4-14 14-20 20-20s16 6 20 20" opacity="0.9" />
                  </svg>
                </div>
                <p className="text-center text-sm font-bold" style={{ color: colors.accent }}>
                  נטלי
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {showStatusDot && (
        <span
          className={`absolute rounded-full border-2 ${isRound ? (size === "micro" ? "bottom-0 left-0 h-2 w-2" : "bottom-0 left-0 h-2.5 w-2.5 sm:h-3 sm:w-3") : "bottom-3 left-3 h-3.5 w-3.5 md:bottom-4 md:left-4"}`}
          style={{ backgroundColor: colors.successText, borderColor: colors.surface }}
          aria-hidden
        />
      )}
    </div>
  );
}
