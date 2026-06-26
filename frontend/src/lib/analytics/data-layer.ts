declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export function pushToDataLayer(event: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(event);
}

export function trackGtmPageView(pagePath: string) {
  pushToDataLayer({
    event: "page_view",
    page_path: pagePath,
  });
}
