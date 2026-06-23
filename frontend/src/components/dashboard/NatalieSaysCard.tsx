import { Sparkles } from "lucide-react";
import { colors, radius, shadow, button, type } from "@/lib/design-tokens";

export function NatalieSaysCard({
  pendingCount,
  onShow,
  onDismiss,
}: {
  pendingCount: number;
  onShow: () => void;
  onDismiss: () => void;
}) {
  const message =
    pendingCount > 0
      ? "מצאתי כמה דברים שמחכים לאישור שלך. כדאי להתחיל מהמסמכים עם סכומים גבוהים או תאריכים קרובים."
      : "הכל נראה מסודר כרגע. אני כאן אם תרצה שאבדוק משהו נוסף בעסק.";

  return (
    <section
      className={`${radius.card} border ${shadow.soft} overflow-hidden`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        backgroundImage: "linear-gradient(180deg, rgba(29,91,255,0.05) 0%, rgba(255,255,255,0) 100%)",
      }}
      aria-label="נטלי אומרת"
    >
      <div className="flex gap-4 p-5 md:p-6">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-md"
          style={{ background: `linear-gradient(135deg, ${colors.accent}, #4F7DFF)` }}
        >
          <Sparkles className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={type.sectionTitle} style={{ color: colors.accent }}>
            נטלי אומרת
          </h2>
          <p className={`${type.body} mt-2 leading-8`} style={{ color: colors.textPrimary }}>
            {message}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {pendingCount > 0 ? (
              <>
                <button
                  type="button"
                  onClick={onShow}
                  className={`${radius.control} ${button.primary} w-full sm:w-auto`}
                  style={{
                    backgroundColor: colors.accent,
                    border: `1px solid ${colors.accent}`,
                    color: colors.surface,
                    boxShadow: "0 12px 28px rgba(29,91,255,0.22)",
                  }}
                >
                  תראי לי מה חשוב
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textSecondary,
                  }}
                >
                  לא עכשיו
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onShow}
                className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
                style={{
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.accent}`,
                  color: colors.accent,
                }}
              >
                דבר איתי
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
