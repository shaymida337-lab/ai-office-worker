import type { BillingSummary } from "@/lib/billing/model";

export function BillingBanner({ summary }: { summary: BillingSummary }) {
  if (!summary.readOnly) return null;
  return <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">החשבון במצב קריאה בלבד. כדי לחזור לעבודה מלאה יש להפעיל מנוי.</div>;
}
