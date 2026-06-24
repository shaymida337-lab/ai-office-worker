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
  size?: "default" | "hero" | "avatar";
  showStatusDot?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  const sizeClass =
    size === "avatar"
      ? "h-[72px] w-[72px] shrink-0 rounded-full md:h-[88px] md:w-[88px]"
      : size === "hero"
        ? "aspect-[4/5] w-full max-w-[360px] md:max-w-[420px]"
        : "aspect-[3/4] w-full max-w-[220px]";

  const isAvatar = size === "avatar";

  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`relative overflow-hidden ${isAvatar ? sizeClass : `${radius.lg} ${sizeClass}`}`}
        style={{
          boxShadow: isAvatar ? "0 2px 10px rgba(15,23,42,0.07)" : "0 20px 50px rgba(29,91,255,0.18)",
          border: `1px solid ${colors.borderSubtle}`,
          backgroundColor: colors.surface,
        }}
      >
        {!imageError ? (
          <Image
            src={PORTRAIT_SRC}
            alt="נטלי"
            fill
            priority={isAvatar}
            className="object-cover object-top"
            sizes={isAvatar ? "88px" : "(max-width: 768px) 180px, 220px"}
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${isAvatar ? "" : "flex-col justify-end p-6"}`}
            style={{
              backgroundColor: colors.surface,
              background: isAvatar
                ? undefined
                : `linear-gradient(165deg, ${colors.accentSoft} 0%, #E0E7FF 45%, ${colors.surface} 100%)`,
            }}
          >
            {isAvatar ? (
              <span className="text-2xl font-extrabold md:text-3xl" style={{ color: colors.accent }} aria-hidden>
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
      {showStatusDot && isAvatar && (
        <span
          className="absolute bottom-0.5 left-0.5 h-3 w-3 rounded-full border-2 md:bottom-1 md:left-1"
          style={{ backgroundColor: colors.successText, borderColor: colors.surface }}
          aria-hidden
        />
      )}
    </div>
  );
}
