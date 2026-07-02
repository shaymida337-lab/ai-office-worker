export type MorningGreeting = {
  headline: string;
  leadIn: string;
};

type BuildMorningGreetingInput = {
  ownerFirstName?: string | null;
  returningUser?: boolean;
  hasWorkToday?: boolean;
  now?: Date;
};

function greetingPrefix(now: Date, returningUser: boolean): string {
  if (returningUser) {
    return "ברוך הבא חזרה";
  }
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 22) return "ערב טוב";
  return "שלום";
}

export function buildMorningGreeting(input: BuildMorningGreetingInput): MorningGreeting {
  const now = input.now ?? new Date();
  const returningUser = Boolean(input.returningUser);
  const prefix = greetingPrefix(now, returningUser);
  const name = input.ownerFirstName?.trim();
  const emoji = returningUser ? "" : " 👋";
  const headline = name ? `${prefix}, ${name}${emoji}` : `${prefix}${emoji}`;

  const leadIn = input.hasWorkToday
    ? "הנה מה שכבר עשיתי עבורך היום"
    : returningUser
      ? "סיכמתי לך את היום — זה מה שחשוב עכשיו"
      : "אני כאן לעבוד בשבילך — בוא נתחיל";

  return { headline, leadIn };
}
