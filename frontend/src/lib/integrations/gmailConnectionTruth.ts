import type { GmailStatus } from "@/lib/api";

export type GmailStatusResolution = {
  nextStatus: GmailStatus | null;
  known: boolean;
  stale: boolean;
};

export function resolveGmailStatusFromSettled(
  previous: GmailStatus | null,
  settled: PromiseSettledResult<GmailStatus>
): GmailStatusResolution {
  if (settled.status === "fulfilled") {
    return {
      nextStatus: settled.value,
      known: true,
      stale: false,
    };
  }
  if (previous) {
    return {
      nextStatus: previous,
      known: true,
      stale: true,
    };
  }
  return {
    nextStatus: null,
    known: false,
    stale: true,
  };
}
