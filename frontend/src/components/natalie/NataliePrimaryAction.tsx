import type { NataliePrimaryActionModel } from "@/lib/natalie/types";

export type NataliePrimaryActionProps = {
  action: NataliePrimaryActionModel;
  onAction?: (intent: string) => void;
  className?: string;
};

export function NataliePrimaryAction({ action, onAction, className = "" }: NataliePrimaryActionProps) {
  const content = action.label;

  if (action.href && !action.disabled) {
    return (
      <a
        href={action.href}
        className={className}
        data-natalie-surface="primary-action"
        data-intent={action.intent}
        aria-label={action.reason ?? action.label}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      data-natalie-surface="primary-action"
      data-intent={action.intent}
      disabled={action.disabled}
      aria-label={action.reason ?? action.label}
      onClick={() => onAction?.(action.intent)}
    >
      {content}
    </button>
  );
}
