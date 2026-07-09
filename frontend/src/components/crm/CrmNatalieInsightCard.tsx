"use client";

import { Button } from "@/components/natalie-ui";

export function CrmNatalieInsightCard({
  message,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  message: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <section className="rounded-3xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB,#3B82F6)] p-5 text-white shadow-[0_18px_44px_rgba(37,99,235,0.3)] transition-shadow duration-300 md:p-6">
      <p className="text-sm font-semibold text-blue-100">נטלי</p>
      <p className="mt-2 text-base font-bold leading-7 md:text-lg">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={onPrimary}
          className="!border-white/20 !bg-white !text-[#1E40AF] hover:!bg-blue-50"
        >
          {primaryLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onSecondary}
          className="!text-white hover:!bg-white/10"
        >
          {secondaryLabel}
        </Button>
      </div>
    </section>
  );
}
