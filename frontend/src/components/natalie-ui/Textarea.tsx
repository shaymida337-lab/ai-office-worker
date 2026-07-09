"use client";

import type { TextareaHTMLAttributes } from "react";
import { natalie } from "./tokens";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${natalie.input} ${className}`} {...props} />;
}
