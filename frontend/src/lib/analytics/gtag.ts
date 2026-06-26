import { GA_MEASUREMENT_ID } from "./constants";

export type GtagCommand = "config" | "event" | "js" | "set";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function gtag(...args: [GtagCommand, ...unknown[]]) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag(...args);
}

export function trackPageView(url: string) {
  gtag("config", GA_MEASUREMENT_ID, { page_path: url });
}
