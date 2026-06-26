type LogoProps = {
  size?: "sm" | "md" | "lg";
  showSubtitle?: boolean;
  iconOnly?: boolean;
  className?: string;
};

const sizeMap = {
  sm: { icon: "h-9 w-9", title: "text-[15px]", subtitle: "text-[11px]" },
  md: { icon: "h-10 w-10", title: "text-[17px]", subtitle: "text-[13px]" },
  lg: { icon: "h-14 w-14", title: "text-[28px]", subtitle: "text-[13px]" },
};

/** Official Natalie mark — matches public/favicon.svg */
function NatalieMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="natalie-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a6cff" />
          <stop offset="0.55" stopColor="#1d5bff" />
          <stop offset="1" stopColor="#143cbf" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#natalie-logo-gradient)" />
      <path
        d="M64 192 L128 70 L192 192"
        fill="none"
        stroke="#ffffff"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M80 154 H176" stroke="#34d399" strokeWidth="28" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = "md", showSubtitle = false, iconOnly = false, className = "" }: LogoProps) {
  const sizing = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 ${className}`} dir="rtl">
      <span className={`${sizing.icon} logo-icon overflow-hidden`}>
        <NatalieMark className="h-full w-full" />
      </span>
      {!iconOnly && (
        <span className="min-w-0 text-right">
          <span className={`logo-title block whitespace-nowrap font-extrabold leading-tight tracking-tight ${sizing.title}`}>
            נטלי
          </span>
          {showSubtitle && (
            <span className={`block font-medium text-ink-muted ${sizing.subtitle}`}>עובדת המשרד שלך</span>
          )}
        </span>
      )}
    </div>
  );
}
