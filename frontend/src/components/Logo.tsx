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

export function Logo({ size = "md", showSubtitle = false, iconOnly = false, className = "" }: LogoProps) {
  const sizing = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 ${className}`} dir="rtl">
      <span className={`${sizing.icon} logo-icon`}>
        <svg viewBox="0 0 48 48" aria-hidden="true" className="h-full w-full">
          <defs>
            <linearGradient id={`logo-gradient-${size}`} x1="8" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
              <stop stopColor="#6366F1" />
              <stop offset="1" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <rect width="48" height="48" rx="14" fill={`url(#logo-gradient-${size})`} />
          <path d="M14 31.5 20.4 16h3.2L30 31.5h-3.5l-1.2-3.2h-6.6l-1.2 3.2H14Zm5.7-6h4.6L22 19.4l-2.3 6.1ZM32 16h3.4v15.5H32V16Z" fill="white" />
          <path d="M13.5 34.5h21" stroke="white" strokeOpacity=".42" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      {!iconOnly && (
        <span className="min-w-0 text-right">
          <span className={`logo-title block whitespace-nowrap font-extrabold leading-tight tracking-tight ${sizing.title}`}>נטלי</span>
          {showSubtitle && <span className={`block font-medium text-ink-muted ${sizing.subtitle}`}>עובדת המשרד שלך</span>}
        </span>
      )}
    </div>
  );
}
