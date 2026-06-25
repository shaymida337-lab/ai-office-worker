"use client";

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
      className="rounded-2xl border p-5 md:p-6"
      style={{ backgroundColor: "var(--surface, #fff)", borderColor: "var(--border-subtle, #e2e8f0)" }}
      aria-label="דוגמאות לשיחה עם נטלי"
    >
      <div className="mb-4 text-right">
        <h2 className="text-xl font-extrabold text-slate-900 md:text-2xl">פשוט מבקשים מנטלי</h2>
        <p className="mt-1 text-sm text-slate-600 md:text-base">מדברים איתה כמו עם עובדת משרד — בלי ללמוד מערכת.</p>
      </div>
      <div className="grid gap-3">
        {EXAMPLES.map((example) => (
          <article key={example.user} className="grid gap-2 rounded-2xl bg-slate-50 p-4">
            <p className="text-right text-sm font-semibold text-slate-800 md:text-base">
              <span className="text-slate-500">אתה: </span>
              {example.user}
            </p>
            <p className="text-right text-sm leading-7 text-slate-700 md:text-base">
              <span className="font-bold text-blue-700">נטלי: </span>
              {example.natalie}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
