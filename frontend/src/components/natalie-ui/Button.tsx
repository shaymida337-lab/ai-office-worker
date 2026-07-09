"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonVariants, type ButtonVariant } from "./tokens";

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const sizeClass = size === "sm" && variant === "secondary" ? buttonVariants.secondarySm : "";
  const base = sizeClass || buttonVariants[variant];
  return (
    <button type={type} className={`${base} ${className}`} {...props}>
      {children}
    </button>
  );
}
