import Link from "next/link";
import type { ReactNode } from "react";

const primaryClass =
  "inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl bg-gradient-to-l from-blue-600 to-blue-700 px-6 py-3.5 text-center text-base font-bold text-white shadow-[0_12px_32px_-12px_rgba(29,91,255,0.55)] transition hover:from-blue-700 hover:to-blue-800 sm:w-auto";

const secondaryClass =
  "inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-6 py-3.5 text-center text-base font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 sm:w-auto";

export function BillingPrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={primaryClass}>
      {children}
    </Link>
  );
}

export function BillingSecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={secondaryClass}>
      {children}
    </Link>
  );
}

export function BillingPrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${primaryClass} disabled:opacity-60`}>
      {children}
    </button>
  );
}

export function BillingCTAGroup({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {primary}
      {secondary}
    </div>
  );
}

export function BillingHighlightQuote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="rounded-2xl border border-blue-200/80 bg-gradient-to-l from-blue-50 to-indigo-50/50 px-5 py-4 text-base font-semibold leading-8 text-slate-800 md:px-6 md:text-lg">
      {children}
    </blockquote>
  );
}
