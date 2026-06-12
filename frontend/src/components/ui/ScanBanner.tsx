import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";

type ScanBannerStatus = "running" | "success" | "partial" | "truncated" | "error";

const statusStyles: Record<ScanBannerStatus, { color: string; backgroundColor: string; borderColor: string }> = {
  running: { color: colors.infoText, backgroundColor: colors.infoBg, borderColor: colors.infoBorder },
  success: { color: colors.successText, backgroundColor: colors.successBg, borderColor: colors.successBorder },
  partial: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  truncated: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
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
  const text = scanBannerText(status, found, scanned, totalMatched, errors);
  return (
    <section className={`${radius.card} ${shadow.card} ${spacing.card} border`} style={statusStyles[status]}>
      <div className={`${type.body} max-w-full text-wrap leading-6 font-semibold`}>{text}</div>
      {status === "running" && (
        <div className={`mt-3 h-2 w-full overflow-hidden ${radius.pill}`} style={{ backgroundColor: colors.border }}>
          <div className="h-full transition-all" style={{ width: "45%", backgroundColor: colors.accent }} />
        </div>
      )}
    </section>
  );
}

function scanBannerText(
  status: ScanBannerStatus,
  found: number,
  scanned: number,
  totalMatched: number | null | undefined,
  errors: number
) {
  if (status === "running") return `סורקת את המייל שלך... נמצאו ${found} מסמכים`;
  if (status === "success") return `הסריקה הסתיימה — נמצאו ${found} מסמכים`;
  if (status === "partial") return `הסריקה הסתיימה עם ${errors} שגיאות`;
  if (status === "truncated") return `הסריקה הסתיימה — נמצאו ${found} מסמכים. נסרקו ${scanned} מתוך ${totalMatched ?? scanned} — מומלץ להריץ סריקה נוספת`;
  return `הסריקה נכשלה עם ${errors} שגיאות`;
}
