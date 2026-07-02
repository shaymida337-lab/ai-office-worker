export type HeroStatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export type HeroCtaAction = "ask_natalie" | "connect_gmail" | "show_scan_progress" | "retry_sync";

export type HeroTrustState = {
  statusLabel: string;
  statusTone: HeroStatusTone;
  ctaLabel: string;
  ctaAction: HeroCtaAction;
};

type ResolveHeroTrustInput = {
  gmailStatusKnown: boolean;
  gmailConnected: boolean;
  scanRunning: boolean;
  hasSyncIssue: boolean;
  connectingGmail?: boolean;
};

export function resolveHeroTrustState(input: ResolveHeroTrustInput): HeroTrustState {
  if (input.connectingGmail) {
    return {
      statusLabel: "מחברת את Gmail...",
      statusTone: "info",
      ctaLabel: "חבר Gmail",
      ctaAction: "connect_gmail",
    };
  }

  if (!input.gmailStatusKnown) {
    return {
      statusLabel: "בודקת את חיבור Gmail...",
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

  if (input.hasSyncIssue && input.gmailConnected) {
    return {
      statusLabel: "יש בעיית סנכרון — אפשר לנסות שוב.",
      statusTone: "danger",
      ctaLabel: "נסה שוב",
      ctaAction: "retry_sync",
    };
  }

  if (!input.gmailConnected) {
    return {
      statusLabel: "חבר Gmail כדי שאתחיל לסרוק עבורך מסמכים",
      statusTone: "warn",
      ctaLabel: "חבר Gmail",
      ctaAction: "connect_gmail",
    };
  }

  return {
    statusLabel: "מחוברת, סורקת מיילים ועובדת עבורך",
    statusTone: "success",
    ctaLabel: "שאל את נטלי",
    ctaAction: "ask_natalie",
  };
}
