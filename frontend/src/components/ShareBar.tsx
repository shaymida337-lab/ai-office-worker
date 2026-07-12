"use client";

import { useState } from "react";
import { Check, Link2, Mail } from "lucide-react";
import { pushToDataLayer } from "@/lib/analytics/data-layer";
import { buildShareHref, SHARE_PLATFORMS, type SharePlatform } from "@/lib/share/shareLinks";
import { colors, radius } from "@/lib/design-tokens";

/** אייקוני מותג בקו נקי (lucide לא כולל לוגואים של רשתות) */
function PlatformIcon({ platform }: { platform: SharePlatform }) {
  const common = { width: 18, height: 18, fill: "currentColor", "aria-hidden": true } as const;
  switch (platform) {
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.2-3.4-.7-2.8-1.2-4.6-4-4.8-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.2.2-.3.4-.1.7.2.3.9 1.5 2 2.4 1.4 1.2 2.5 1.6 2.9 1.7.3.2.6.1.7-.1l.9-1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .7-.3 1.2Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M20.4 20.4h-3.5v-5.5c0-1.3 0-3-1.9-3-1.9 0-2.1 1.4-2.1 2.9v5.6H9.4V9h3.3v1.6h.1c.5-.9 1.6-1.9 3.3-1.9 3.6 0 4.2 2.3 4.2 5.4v6.3ZM5.5 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1ZM7.2 20.4H3.7V9h3.5v11.4Z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M18.3 2H21l-6.6 7.6L22.2 22h-6.1l-4.8-6.3L5.8 22H3l7.1-8.1L2.2 2h6.2l4.3 5.7L18.3 2Zm-1.1 18.2h1.7L7.1 3.7H5.3l11.9 16.5Z" />
        </svg>
      );
    case "email":
      return <Mail className="h-[18px] w-[18px]" aria-hidden />;
    case "copy":
      return <Link2 className="h-[18px] w-[18px]" aria-hidden />;
  }
}

type ShareBarProps = {
  variant?: "light" | "dark";
  className?: string;
};

export function ShareBar({ variant = "light", className = "" }: ShareBarProps) {
  const [copied, setCopied] = useState(false);
  const isLight = variant === "light";

  function track(platform: SharePlatform) {
    pushToDataLayer({ event: "share_click", platform });
    if (platform === "copy") pushToDataLayer({ event: "copy_link" });
  }

  async function onCopy() {
    track("copy");
    const url = buildShareHref("copy");
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // fallback לדפדפנים בלי Clipboard API
      const helper = document.createElement("textarea");
      helper.value = url;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  }

  const buttonClass = `${radius.pill} inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-3 text-sm font-bold transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#1d5bff]/15`;
  const buttonStyle = isLight
    ? { borderColor: colors.border, backgroundColor: colors.surface, color: colors.textSecondary }
    : { borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(255,255,255,0.06)", color: "#fff" };

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`} role="group" aria-label="שיתוף נטלי">
      {SHARE_PLATFORMS.map(({ platform, label }) =>
        platform === "copy" ? (
          <button
            key={platform}
            type="button"
            onClick={onCopy}
            aria-label={copied ? "הקישור הועתק" : "העתקת קישור"}
            className={buttonClass}
            style={copied ? { ...buttonStyle, color: colors.successText, borderColor: colors.successBorder } : buttonStyle}
          >
            {copied ? <Check className="h-[18px] w-[18px]" aria-hidden /> : <PlatformIcon platform={platform} />}
            <span className="hidden sm:inline">{copied ? "הועתק!" : label}</span>
          </button>
        ) : (
          <a
            key={platform}
            href={buildShareHref(platform)}
            target={platform === "email" ? undefined : "_blank"}
            rel="noopener noreferrer"
            onClick={() => track(platform)}
            aria-label={`שיתוף ב-${label}`}
            className={buttonClass}
            style={buttonStyle}
          >
            <PlatformIcon platform={platform} />
            <span className="hidden sm:inline">{label}</span>
          </a>
        )
      )}
    </div>
  );
}
