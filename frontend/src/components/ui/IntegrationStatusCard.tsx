"use client";

import { useMemo, useState, type ReactNode } from "react";
import { colors, radius, shadow, spacing, button, type as typography } from "@/lib/design-tokens";
import { StatusPill } from "@/components/ui/StatusPill";
import type { IntegrationDetail, IntegrationMetric, IntegrationStatusBadge, IntegrationStatusModel } from "@/lib/integrations/integrationStatus";

type IntegrationAction = {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  priority?: "primary" | "secondary";
};

type IntegrationStatusCardProps = {
  icon: string;
  title: string;
  model: IntegrationStatusModel;
  actions: IntegrationAction[];
  detailsTitle?: string;
};

const toneMap: Record<IntegrationStatusBadge["tone"], "success" | "warn" | "danger" | "info"> = {
  success: "success",
  warn: "warn",
  danger: "danger",
  info: "info",
};

function renderDetailRows(items: IntegrationDetail[]) {
  return items.map((item) => (
    <div
      key={item.key}
      className={`${radius.control} flex items-center justify-between gap-3 p-3`}
      style={{ backgroundColor: colors.bgSoft, border: `1px solid ${colors.borderSubtle}` }}
    >
      <span className={typography.caption} style={{ color: colors.textSecondary }}>{item.label}</span>
      <span className={typography.caption} style={{ color: colors.textPrimary }}>{item.value}</span>
    </div>
  ));
}

function renderMetricRows(items: IntegrationMetric[]) {
  return items.map((item) => (
    <div
      key={item.key}
      className={`${radius.control} flex min-h-[64px] flex-col justify-center p-3`}
      style={{ backgroundColor: colors.bgSoft, border: `1px solid ${colors.borderSubtle}` }}
    >
      <span className={typography.caption} style={{ color: colors.textSecondary }}>{item.label}</span>
      <span className={`${typography.body} mt-1 font-bold`} style={{ color: colors.textPrimary }}>{item.value}</span>
    </div>
  ));
}

function ActionButton({
  action,
  children,
}: {
  action: IntegrationAction;
  children: ReactNode;
}) {
  const isPrimary = action.priority === "primary";
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      aria-label={action.label}
      className={`${radius.control} ${isPrimary ? button.primary : button.secondary} inline-flex items-center justify-center disabled:opacity-60`}
      style={isPrimary
        ? { backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface }
        : { backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent }}
    >
      {children}
    </button>
  );
}

export function IntegrationStatusCard({
  icon,
  title,
  model,
  actions,
  detailsTitle = "פרטי חיבור",
}: IntegrationStatusCardProps) {
  const [expanded, setExpanded] = useState(false);
  const primaryAction = useMemo(() => actions.find((action) => action.priority === "primary") ?? actions[0], [actions]);
  const secondaryActions = useMemo(
    () => actions.filter((action) => action.id !== primaryAction?.id),
    [actions, primaryAction]
  );

  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card}`}
      style={{ backgroundColor: colors.surface, border: `1px solid ${colors.borderSubtle}` }}
      aria-live="polite"
      data-testid="integration-status-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={typography.cardTitle} style={{ color: colors.textPrimary }}>
            {icon} {title}
          </h2>
          <p className={`${typography.body} mt-2`} style={{ color: colors.textSecondary }}>
            {model.title} · {model.description}
          </p>
        </div>
        {model.badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {model.badges.map((badge) => (
              <StatusPill key={badge.key} tone={toneMap[badge.tone]}>
                {badge.label}
              </StatusPill>
            ))}
          </div>
        ) : null}
      </div>

      {model.metrics.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {renderMetricRows(model.metrics)}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {primaryAction ? (
          <ActionButton action={{ ...primaryAction, priority: "primary" }}>
            {primaryAction.label}
          </ActionButton>
        ) : null}
        {secondaryActions.map((action) => (
          <ActionButton key={action.id} action={action}>{action.label}</ActionButton>
        ))}
      </div>

      {model.details.length > 0 ? (
        <details
          className="mt-4"
          open={expanded}
          onToggle={(event) => setExpanded((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className={`${typography.caption} cursor-pointer font-bold`} style={{ color: colors.accent }}>
            {detailsTitle}
          </summary>
          <div className="mt-3 grid gap-2">{renderDetailRows(model.details)}</div>
        </details>
      ) : null}
    </section>
  );
}
