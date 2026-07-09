"use client";

import type { SelectHTMLAttributes } from "react";
import { natalie } from "./tokens";

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${natalie.input} ${className}`} {...props}>
      {children}
    </select>
  );
}
