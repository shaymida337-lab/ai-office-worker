import type { GmailConnectionPhase } from "@/lib/integrations/gmailConnectionTruth";

export type HeroStatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export type HeroCtaAction = "ask_natalie" | "connect_gmail" | "show_scan_progress" | "retry_sync";

export type HeroTrustState = {
  statusLabel: string;
  statusTone: HeroStatusTone;
  ctaLabel: string;
  ctaAction: HeroCtaAction;
};

type ResolveHeroTrustInput = {
  pageLoading?: boolean;
  gmailStatusKnown: boolean;
  gmailStatusStale?: boolean;
  gmailConnectionPhase: GmailConnectionPhase;
  scanStatusKnown?: boolean;
  scanStatusStale?: boolean;
  scanRunning: boolean;
  hasSyncIssue: boolean;
  connectingGmail?: boolean;
};

const CHECKING_LABEL = "בודקת את מצב החיבור...";
const EVIDENCE_CHECKING_LABEL = "מצאתי מסמכים מהאימייל שלך. מוודאת שהחיבור פעיל.";
const CONNECTED_LABEL = "מחוברת, סורקת ועובדת עבורך";

function isCheckingState(input: ResolveHeroTrustInput) {
  return (
    Boolean(input.pageLoading) ||
    input.gmailConnectionPhase === "unknown" ||
    Boolean(input.gmailStatusStale) ||
    Boolean(input.scanStatusStale) ||
    (input.gmailConnectionPhase === "connected" && input.scanStatusKnown === false)
  );
}

export function resolveHeroTrustState(input: ResolveHeroTrustInput): HeroTrustState {
  if (input.connectingGmail) {
    return {
      statusLabel: "מחברת את Gmail...",
      statusTone: "info",
      ctaLabel: "חבר Gmail",
      ctaAction: "connect_gmail",
    };
  }

  if (input.gmailConnectionPhase === "evidence_ambiguous") {
    return {
      statusLabel: EVIDENCE_CHECKING_LABEL,
      statusTone: "neutral",
      ctaLabel: "שאל את נטלי",
      ctaAction: "ask_natalie",
    };
  }

  if (isCheckingState(input)) {
    return {
      statusLabel: CHECKING_LABEL,
      statusTone: "neutral",
      ctaLabel: "שאל את נטלי",
      ctaAction: "ask_natalie",
    };
  }

  if (input.scanRunning) {
    return {
      statusLabel: "סורקת עבורך מסמכים...",
      statusTone: "warn",
      ctaLabel: "הצג התקדמות",
      ctaAction: "show_scan_progress",
    };
  }

  if (input.hasSyncIssue && input.gmailConnectionPhase === "connected") {
    return {
      statusLabel: "יש בעיית סנכרון — אפשר לנסות שוב.",
      statusTone: "danger",
      ctaLabel: "נסה שוב",
      ctaAction: "retry_sync",
    };
  }

  if (input.gmailConnectionPhase === "disconnected") {
    return {
      statusLabel: "חבר Gmail כדי שאתחיל לסרוק עבורך מסמכים",
      statusTone: "warn",
      ctaLabel: "חבר Gmail",
      ctaAction: "connect_gmail",
    };
  }

  return {
    statusLabel: CONNECTED_LABEL,
    statusTone: "success",
    ctaLabel: "שאל את נטלי",
    ctaAction: "ask_natalie",
  };
}
