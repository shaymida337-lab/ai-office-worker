import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";

const c = legacyColorMap;

export const loadingPatterns = {
  /** Prefer skeletons over spinners */
  skeleton: "animate-pulse rounded-lg",
  skeletonStyle: { backgroundColor: c.bgSoft },
  skeletonRow: `${radius.md} flex gap-4 border p-5`,
  skeletonBar: "h-5 rounded-lg",
  skeletonAvatar: "h-12 w-12 rounded-2xl",
  /** Thin progress bar for known operations (scan) */
  progressTrack: "h-1.5 w-full overflow-hidden rounded-full",
  progressTrackStyle: { backgroundColor: c.borderSubtle },
  progressFill: "h-full rounded-full transition-all duration-300",
  progressFillStyle: { backgroundColor: c.accent },
  /** Spinner — last resort only */
  spinner: "h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent",
  optimistic: "opacity-70 pointer-events-none",
} as const;
