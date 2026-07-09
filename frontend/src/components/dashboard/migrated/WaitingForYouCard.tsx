"use client";

import { Button } from "@/components/natalie-ui";

export function WaitingForYouCard({
  title,
  value,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  value: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#FBCFE8] bg-[#FFF1F7] p-4 shadow-sm">
      <p className="text-sm font-semibold text-[#9D174D]">{title}</p>
      <p className="mt-1 text-2xl font-black text-[#831843]">{value}</p>
      <p className="mt-1 text-sm text-[#9F1239]">{subtitle}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onAction}
        className="mt-3 !border-[#F9A8D4] !bg-white !text-[#9D174D] hover:!bg-[#FFE4EF]"
      >
        {actionLabel}
      </Button>
    </section>
  );
}
