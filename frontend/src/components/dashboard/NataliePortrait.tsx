"use client";

import Image from "next/image";
import { useState } from "react";
import { colors, radius } from "@/lib/design-tokens";

const PORTRAIT_SRC = "/natalie-portrait.png";

export function NataliePortrait({
  className = "",
  size = "default",
}: {
  className?: string;
  size?: "default" | "hero" | "avatar";
}) {
  const [imageError, setImageError] = useState(false);
  const sizeClass =
    size === "avatar"
      ? "h-20 w-20 shrink-0 rounded-full md:h-24 md:w-24"
      : size === "hero"
        ? "aspect-[4/5] w-full max-w-[360px] md:max-w-[420px]"
        : "aspect-[3/4] w-full max-w-[220px]";

  const isAvatar = size === "avatar";

  return (
    <div
      className={`relative overflow-hidden ${isAvatar ? sizeClass : `${radius.lg} ${sizeClass}`} ${className}`}
      style={{
        boxShadow: isAvatar ? "0 4px 16px rgba(15,23,42,0.1)" : "0 20px 50px rgba(29,91,255,0.18)",
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      {!imageError ? (
        <Image
          src={PORTRAIT_SRC}
          alt="נטלי — העובדת המשרדית שלך"
          fill
          priority={isAvatar}
          className="object-cover object-top"
          sizes={isAvatar ? "96px" : "(max-width: 768px) 180px, 220px"}
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center ${isAvatar ? "" : "flex-col justify-end p-6"}`}
          style={{
            background: isAvatar
              ? `linear-gradient(135deg, ${colors.accentSoft} 0%, #E0E7FF 100%)`
              : `linear-gradient(165deg, ${colors.accentSoft} 0%, #E0E7FF 45%, ${colors.surface} 100%)`,
          }}
        >
          <div
            className={`grid place-items-center rounded-full ${isAvatar ? "h-full w-full" : "mb-4 h-28 w-28"}`}
            style={
              isAvatar
                ? undefined
                : {
                    background: `linear-gradient(135deg, ${colors.accent} 0%, #6D28D9 100%)`,
                    boxShadow: "0 12px 32px rgba(29,91,255,0.25)",
                  }
            }
            aria-hidden
          >
            <svg
              viewBox="0 0 64 64"
              className={isAvatar ? "h-10 w-10" : "h-16 w-16"}
              style={{ color: isAvatar ? colors.accent : "white" }}
              fill="currentColor"
            >
              <circle cx="32" cy="22" r="12" opacity="0.95" />
              <path d="M12 58c4-14 14-20 20-20s16 6 20 20" opacity="0.9" />
            </svg>
          </div>
          {!isAvatar && (
            <p className="text-center text-sm font-bold" style={{ color: colors.accent }}>
              נטלי
            </p>
          )}
        </div>
      )}
    </div>
  );
}
