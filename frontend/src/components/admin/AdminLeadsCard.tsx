"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import { useLeadAdminSummary } from "@/hooks/useLeadAdminSummary";

function AdminLeadsCardActive() {
  const { summary } = useLeadAdminSummary(true);
  if (!summary) return null;

  const stats = [
    { label: "חדשים", value: summary.newCount, highlight: summary.newCount > 0 },
    { label: "היום", value: summary.today },
    { label: "השבוע", value: summary.week },
    { label: "החודש", value: summary.month },
    { label: "מתאימים", value: summary.qualified },
    { label: "לקוחות", value: summary.converted },
  ];

  return (
    <Link
      href="/admin/leads"
      className="block rounded-[22px] border border-[#e6eaf2] bg-white p-4 shadow-[0_10px_34px_rgba(20,40,90,0.08)] transition hover:-translate-y-0.5 md:p-5"
      data-testid="admin-leads-card"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#eaf0ff] text-[#1d5bff]">
          <UserPlus className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="m-0 text-lg font-extrabold text-[#0f1830]">לידים שיווקיים</h2>
      </div>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[12px] bg-[#f4f6fb] px-2 py-2 text-center">
            <dd
              className="text-xl font-extrabold tabular-nums"
              style={{ color: stat.highlight ? "#e02f44" : "#0f1830" }}
            >
              {stat.value}
            </dd>
            <dt className="text-xs font-bold text-[#6b7686]">{stat.label}</dt>
          </div>
        ))}
      </dl>
    </Link>
  );
}

/** כרטיס לידים במסך הבית — נטען רק לאדמין הפלטפורמה; לכל השאר לא מרונדר ובלי hook סיכום. */
export function AdminLeadsCard() {
  const isAdmin = useIsPlatformAdmin();
  if (isAdmin !== true) return null;
  return <AdminLeadsCardActive />;
}
