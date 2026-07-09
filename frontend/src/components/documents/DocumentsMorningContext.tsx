"use client";

import { Sparkles } from "lucide-react";
import { Card } from "@/components/natalie-ui";
import { useI18n } from "@/i18n";

export function DocumentsMorningContext({
  pendingCount,
  loading = false,
  statusMessage,
}: {
  pendingCount: number;
  loading?: boolean;
  statusMessage?: string;
}) {
  const { t } = useI18n();

  const pendingMessage =
    pendingCount === 0
      ? t("documentsDesign.briefEmpty")
      : pendingCount === 1
        ? t("documentsDesign.briefOne")
        : t("documentsDesign.briefMany", { count: String(pendingCount) });

  return (
    <Card
      padding="lg"
      className="bg-[linear-gradient(135deg,rgba(29,78,216,0.04)_0%,rgba(255,255,255,0)_55%)]"
      aria-label={t("documentsDesign.title")}
    >
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#F3E8FF] text-[#6D28D9]">
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black text-[var(--natalie-text-primary,#0F172A)] md:text-3xl">
            {t("documentsDesign.title")}
          </h1>
          {loading ? (
            <p className="mt-3 text-base text-[var(--natalie-text-muted,#64748B)]">{t("documentsDesign.loading")}</p>
          ) : (
            <>
              <p className="mt-3 text-base font-semibold leading-8 text-[var(--natalie-text-primary,#0F172A)]">
                {t("documentsDesign.briefIntro")}
              </p>
              <p className="mt-2 text-base leading-7 text-[var(--natalie-text-muted,#64748B)]">{pendingMessage}</p>
              {statusMessage ? (
                <p className="mt-3 text-base font-semibold leading-7 text-[#065F46]">{statusMessage}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
