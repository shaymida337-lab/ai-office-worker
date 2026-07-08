import type { NatalieRecommendation } from "@/lib/natalie/types";

export type HeroCtaIntent = "connect_gmail" | "run_scan" | "navigate" | "ask_natalie";

export type HeroBriefing = {
  recommendation: string;
  ctaLabel: string;
  ctaIntent: HeroCtaIntent;
};

const SYNC_SURFACE_PATTERN =
  /מחוברת,?\s*סורק|סורקת\s+ומעד|בודקת\s+את\s+מצב|יש\s+בעיית\s+סנכרון|OAuth|Gmail\s+לא|השרת\s+אינו|AI\s+איטי|סנכרון\s+פעיל|מתחבר\s+ל-?Gmail/i;

function joinSentences(title: string, reason: string): string {
  const t = title.trim();
  const r = reason.trim();
  if (!t) return r;
  if (!r || t.includes(r)) return t;
  if (r.includes(t)) return r;
  return `${t.replace(/\.$/, "")}. ${r.replace(/^\./, "")}`;
}

export function heroBriefingHasSyncDuplicate(text: string): boolean {
  return SYNC_SURFACE_PATTERN.test(text.trim());
}

export function resolveHeroCtaIntent(input: {
  recommendation: NatalieRecommendation;
  firstVisitMode: boolean;
  scanRunning: boolean;
  gmailConnected: boolean;
}): HeroCtaIntent {
  if (!input.gmailConnected || input.recommendation.kind === "connect_gmail") {
    return "connect_gmail";
  }
  if (input.firstVisitMode && !input.scanRunning) {
    return "run_scan";
  }
  if (input.recommendation.href) {
    return "navigate";
  }
  return "ask_natalie";
}

export function buildHeroBriefing(input: {
  recommendation: NatalieRecommendation;
  scanRunning: boolean;
  gmailConnected: boolean;
  firstVisitMode: boolean;
  pendingDecisionCount: number;
  ownerFirstName?: string | null;
}): HeroBriefing {
  const ctaIntent = resolveHeroCtaIntent(input);

  if (!input.gmailConnected || input.recommendation.kind === "connect_gmail") {
    return {
      recommendation: "ברגע שנחבר את הג׳ימייל, אוכל להתחיל לסדר את המסמכים והתשלומים בשבילך.",
      ctaLabel: "חבר ג׳ימייל",
      ctaIntent: "connect_gmail",
    };
  }

  if (input.firstVisitMode && !input.scanRunning) {
    return {
      recommendation: "בוא נעשה סריקה ראשונה — אמצא עבורך חשבוניות ותשלומים מהמייל.",
      ctaLabel: "התחל סריקה",
      ctaIntent: "run_scan",
    };
  }

  if (input.scanRunning && input.recommendation.kind === "all_clear") {
    return {
      recommendation: "אני ממשיכה לעבור על המיילים. אעדכן אותך כשיהיה משהו שכדאי לעשות.",
      ctaLabel: "שאל את נטלי",
      ctaIntent: "ask_natalie",
    };
  }

  if (input.recommendation.kind === "all_clear" && input.pendingDecisionCount === 0) {
    return {
      recommendation: "לא נדרש ממך שום טיפול כרגע.",
      ctaLabel: input.recommendation.ctaLabel || "שאל את נטלי",
      ctaIntent: "ask_natalie",
    };
  }

  const recommendation = joinSentences(input.recommendation.title, input.recommendation.reason);

  return {
    recommendation,
    ctaLabel: input.recommendation.ctaLabel,
    ctaIntent,
  };
}
