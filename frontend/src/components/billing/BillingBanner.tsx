import type { BillingSummary } from "@/lib/billing/model";

export function BillingBanner({ summary }: { summary: BillingSummary }) {
  const isRestricted = summary.readOnly;
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        isRestricted ? "border-amber-300 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"
      }`}
    >
      {isRestricted
        ? "החשבון במצב קריאה בלבד. כדי לחזור לעבודה מלאה יש להפעיל מנוי."
        : "זהו מצב דמה לבדיקות ספרינט 1.1 (ללא סליקה אמיתית)."}
    </div>
  );
}
