"use client";

import { MessageCircle, Phone, UserRound } from "lucide-react";
import { Button, Card, StatusBadge, buttonVariants } from "@/components/natalie-ui";
import { callHref, formatInteractionDate, formatTaskDate, sourceLabel, stageTone, whatsappHref } from "./crmHelpers";
import type { Lead } from "./types";

export function CrmCustomerCard({
  lead,
  locale,
  labels,
  onOpen,
}: {
  lead: Lead;
  locale: string;
  labels: {
    lastInteraction: string;
    nextTask: string;
    source: string;
    whatsapp: string;
    call: string;
    openProfile: string;
  };
  onOpen: () => void;
}) {
  const wa = whatsappHref(lead);
  const tel = callHref(lead);
  const tone = stageTone(lead.stage);

  return (
    <Card className="p-4 transition duration-200 hover:shadow-md">
      <button type="button" onClick={onOpen} className="w-full text-start">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-[var(--natalie-text-primary,#0F172A)]">{lead.name}</h3>
            <p className="mt-0.5 truncate text-sm text-[var(--natalie-text-muted,#64748B)]" dir="ltr">
              {lead.phone || lead.email || "—"}
            </p>
          </div>
          <StatusBadge tone={tone}>{lead.stage}</StatusBadge>
        </div>

        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.lastInteraction}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">
              {formatInteractionDate(lead.lastContactAt || lead.updatedAt, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.nextTask}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">
              {formatTaskDate(lead.nextReminderAt, locale)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--natalie-text-muted,#64748B)]">{labels.source}</dt>
            <dd className="font-semibold text-[var(--natalie-text-primary,#0F172A)]">{sourceLabel(lead.source)}</dd>
          </div>
        </dl>
      </button>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--natalie-border,#D9E2F2)] pt-4">
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={labels.whatsapp}
            className={buttonVariants.secondarySm}
          >
            <MessageCircle className="h-4 w-4" />
            <span className="hidden sm:inline">{labels.whatsapp}</span>
          </a>
        ) : null}
        {tel ? (
          <a href={tel} aria-label={labels.call} className={buttonVariants.secondarySm}>
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">{labels.call}</span>
          </a>
        ) : null}
        <Button variant="ghost" size="sm" type="button" onClick={onOpen}>
          <UserRound className="h-4 w-4" />
          {labels.openProfile}
        </Button>
      </div>
    </Card>
  );
}
