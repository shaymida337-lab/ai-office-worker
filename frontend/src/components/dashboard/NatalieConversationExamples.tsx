"use client";

import { colors, dashboardHome } from "@/lib/design-tokens";

const EXAMPLES = [
  {
    user: "נטלי, מה אני צריך לשלם השבוע?",
    natalie: "מצאתי לך את התשלומים הקרובים. יש 3 דברים שכדאי לבדוק.",
  },
  {
    user: "איפה החשבונית של וולט?",
    natalie: "מצאתי אותה. היא גם שמורה בדרייב.",
  },
  {
    user: "כמה שילמתי לפנגו השנה?",
    natalie: "בדקתי לפי הנתונים הקיימים ומצאתי את הסכום.",
  },
] as const;

export function NatalieConversationExamples() {
  return (
    <section
      className="rounded-2xl border p-6 md:p-7"
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="דוגמאות לשיחה עם נטלי"
    >
      <div className="mb-5 space-y-2.5 text-right">
        <h2 className={dashboardHome.mainSectionTitle} style={{ color: colors.textPrimary }}>
          פשוט מבקשים מנטלי
        </h2>
        <p className={dashboardHome.sectionSubtitle} style={{ color: colors.textSecondary }}>
          מדברים איתה כמו עם עובדת משרד — בלי ללמוד מערכת.
        </p>
      </div>
      <div className="grid gap-4">
        {EXAMPLES.map((example) => (
          <article
            key={example.user}
            className="grid gap-3.5 rounded-2xl p-5 md:p-6"
            style={{ backgroundColor: colors.bgSoft }}
          >
            <p className={`${dashboardHome.prompt} text-right`} style={{ color: colors.textPrimary }}>
              <span style={{ color: colors.textMuted }}>אתה: </span>
              {example.user}
            </p>
            <p className={`${dashboardHome.conversation} text-right`} style={{ color: colors.textSecondary }}>
              <span className="font-bold" style={{ color: colors.accent }}>
                נטלי:{" "}
              </span>
              {example.natalie}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
