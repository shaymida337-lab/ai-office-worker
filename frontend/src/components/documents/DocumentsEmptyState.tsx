"use client";

import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export function DocumentsEmptyState() {
  return (
    <EmptyState
      icon={<CheckCircle2 className="h-8 w-8" strokeWidth={2.5} />}
      title="עברתי על כל המסמכים"
      hint="כרגע אין שום דבר שמחכה להחלטה שלך."
    />
  );
}
