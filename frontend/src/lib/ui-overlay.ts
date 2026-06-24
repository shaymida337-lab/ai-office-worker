/** Reference-counted body lock while modals / sheets are open. */
export function lockUiOverlay() {
  const next = Number(document.body.dataset.uiOverlayLock ?? 0) + 1;
  document.body.dataset.uiOverlayLock = String(next);
  document.body.classList.add("ui-overlay-open");
}

export function unlockUiOverlay() {
  const next = Math.max(0, Number(document.body.dataset.uiOverlayLock ?? 0) - 1);
  document.body.dataset.uiOverlayLock = String(next);
  if (next === 0) {
    document.body.classList.remove("ui-overlay-open");
  }
}

export function isUiOverlayOpen() {
  return document.body.classList.contains("ui-overlay-open");
}
