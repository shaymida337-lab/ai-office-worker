import { ScanLine } from "lucide-react";
import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";
import { formatScanBannerText, type ScanBannerStatus } from "@/lib/gmailScanBanner";

const statusStyles: Record<ScanBannerStatus, { color: string; backgroundColor: string; borderColor: string }> = {
  running: { color: colors.infoText, backgroundColor: colors.infoBg, borderColor: colors.infoBorder },
  success: { color: colors.successText, backgroundColor: colors.successBg, borderColor: colors.successBorder },
  partial: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  truncated: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  paused: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  stale: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  error: { color: colors.dangerText, backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
};

export function ScanBanner({
  status,
  found = 0,
  scanned = 0,
  totalMatched,
  errors = 0,
}: {
  status: ScanBannerStatus;
  found?: number;
  scanned?: number;
  totalMatched?: number | null;
  errors?: number;
}) {
  const text = formatScanBannerText(status, found, scanned, totalMatched, errors);
  return (
    <section
      className={`${radius.card} ${shadow.card} border ${spacing.card}`}
      style={statusStyles[status]}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: "rgba(255,255,255,0.72)", color: statusStyles[status].color }}
        >
          <ScanLine className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`${type.body} font-bold leading-7`}>{text}</div>
          {status === "running" && (
            <div className={`mt-4 h-2.5 w-full overflow-hidden ${radius.pill}`} style={{ backgroundColor: "rgba(255,255,255,0.55)" }}>
              <div
                className="h-full animate-pulse rounded-full transition-all duration-500"
                style={{ width: "45%", backgroundColor: colors.accent }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
