import type { BillingSummary } from "@/lib/billing/model";

function formatDate(value: string | null) {
  if (!value) return "לא זמין";
  return new Date(value).toLocaleDateString("he-IL");
}

export function SubscriptionStatusCard({ summary }: { summary: BillingSummary }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-900">סטטוס מנוי</h2>
      <dl className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
        <div>
          <dt className="font-semibold">ארגון</dt>
          <dd>{summary.organizationName}</dd>
        </div>
        <div>
          <dt className="font-semibold">מצב</dt>
          <dd>{summary.status}</dd>
        </div>
        <div>
          <dt className="font-semibold">מסלול</dt>
          <dd>{summary.planName ?? "ללא מסלול פעיל"}</dd>
        </div>
        <div>
          <dt className="font-semibold">חיוב הבא</dt>
          <dd>{formatDate(summary.nextBillingAt)}</dd>
        </div>
      </dl>
    </section>
  );
}
