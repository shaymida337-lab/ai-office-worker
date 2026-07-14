"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export function SlidePanel({
  open,
  title,
  subtitle,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  if (!open) return null;

  // z-[70]: מעל bottom-nav (z-50) ו-FAB של נטלי (z-60) כדי שלחיצות בתוך החלון לא ייחסמו.
  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-black/40 backdrop-blur-sm transition-opacity duration-300"
      onClick={onClose}
    >
      <aside
        className="relative z-[71] flex h-full w-full max-w-lg flex-col border-s border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-card-bg,#ffffff)] shadow-2xl transition-transform duration-300 ease-out"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--natalie-border,#D9E2F2)] p-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black text-[var(--natalie-text-primary,#0F172A)]">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-[var(--natalie-text-muted,#64748B)]">{subtitle}</p> : null}
          </div>
          <Button variant="secondary" size="sm" type="button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative z-[71] flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="relative z-[71] border-t border-[var(--natalie-border,#D9E2F2)] p-4">{footer}</div> : null}
      </aside>
    </div>
  );
}
