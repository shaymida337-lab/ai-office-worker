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
  size?: "default" | "hero";
}) {
  const [imageError, setImageError] = useState(false);
  const sizeClass =
    size === "hero"
      ? "aspect-[4/5] w-full max-w-[360px] md:max-w-[420px]"
      : "aspect-[3/4] w-full max-w-[220px]";

  return (
    <div
      className={`relative mx-auto overflow-hidden ${radius.lg} ${sizeClass} ${className}`}
      style={{
        boxShadow: "0 20px 50px rgba(29,91,255,0.18)",
        border: `1px solid ${colors.borderSubtle}`,
      }}
    >
      {!imageError ? (
        <Image
          src={PORTRAIT_SRC}
          alt="נטלי — העובדת המשרדית שלך"
          fill
          priority
          className="object-cover object-top"
          sizes="(max-width: 768px) 180px, 220px"
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-end p-6"
          style={{
            background: `linear-gradient(165deg, ${colors.accentSoft} 0%, #E0E7FF 45%, ${colors.surface} 100%)`,
          }}
        >
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
        </div>
      )}
    </div>
  );
}
