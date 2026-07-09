"use client";

import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";

export function DocumentsEmptyState() {
  const { t } = useI18n();

  return (
    <EmptyState
      title={t("documentsDesign.emptyTitle")}
      description={t("documentsDesign.emptyHint")}
      action={<CheckCircle2 className="mx-auto h-8 w-8 text-[#065F46]" strokeWidth={2.5} />}
    />
  );
}
