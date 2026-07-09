"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { natalie } from "./tokens";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...props },
  ref
) {
  return <input ref={ref} className={`${natalie.input} ${className}`} {...props} />;
});
