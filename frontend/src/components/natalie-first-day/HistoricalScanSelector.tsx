"use client";

/**
 * בורר עומק הסריקה ההיסטורית (1–5 שנים) עבור זרימת ה-onboarding.
 * רכיב מבוקר: מקבל את הערך הנבחר ומחזיר בחירה דרך onChange. השמירה בפועל
 * ל-PATCH /api/settings מתבצעת בזרימה עצמה, לפני הפעלת ה-OAuth/סריקת Gmail.
 */

export const HISTORICAL_SCAN_OPTIONS: Array<{
  years: 1 | 2 | 3 | 4 | 5;
  label: string;
  hint?: string;
}> = [
  { years: 1, label: "שנה", hint: "מומלץ לסריקה מהירה" },
  { years: 2, label: "שנתיים", hint: "ברירת מחדל" },
  { years: 3, label: "3 שנים" },
  { years: 4, label: "4 שנים" },
  { years: 5, label: "5 שנים", hint: "חובה רגולטורית מלאה" },
];

type HistoricalScanSelectorProps = {
  value: number;
  onChange: (years: 1 | 2 | 3 | 4 | 5) => void;
  disabled?: boolean;
};

export function HistoricalScanSelector({ value, onChange, disabled = false }: HistoricalScanSelectorProps) {
  return (
    <section className="grid gap-3" dir="rtl" data-testid="historical-scan-selector">
      <div className="grid gap-1">
        <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">
          לאיזה עומק היסטורי תרצה שנבצע סריקה ראשונית?
        </h2>
        <p className="text-sm leading-6 text-slate-600">
          נסרוק את תיבת המייל והקבצים שלך כדי לארגן את כל החשבוניות ההיסטוריות במקום אחד.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="עומק סריקה היסטורית"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
      >
        {HISTORICAL_SCAN_OPTIONS.map((option) => {
          const selected = value === option.years;
          return (
            <button
              key={option.years}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.years)}
              data-testid={`historical-scan-option-${option.years}`}
              className={[
                "flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl border p-3 text-center transition duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                disabled ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5",
                selected
                  ? "border-blue-500 bg-blue-50 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.6)]"
                  : "border-slate-200/90 bg-white hover:border-blue-200",
              ].join(" ")}
            >
              <span className={`text-lg font-extrabold ${selected ? "text-blue-700" : "text-slate-900"}`}>
                {option.label}
              </span>
              {option.hint && (
                <span className={`text-xs font-semibold ${selected ? "text-blue-600" : "text-slate-500"}`}>
                  {option.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default HistoricalScanSelector;
