"use client";

import type { InputHTMLAttributes } from "react";
import { natalie } from "./tokens";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${natalie.input} ${className}`} {...props} />;
}
