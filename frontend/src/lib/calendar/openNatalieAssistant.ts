export type OpenNatalieAssistantDetail = {
  message?: string;
};

export function openNatalieAssistant(message?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenNatalieAssistantDetail>("open-natalie-assistant", {
      detail: message ? { message } : {},
    })
  );
}
