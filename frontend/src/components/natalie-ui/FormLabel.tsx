"use client";

import type { LabelHTMLAttributes, ReactNode } from "react";

export function FormLabel({
  children,
  className = "",
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label className={`block font-semibold text-[#111827] dark:text-[var(--natalie-text-primary,#F8FAFC)] ${className}`} {...props}>
      {children}
    </label>
  );
}
