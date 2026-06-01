export function startOfCurrentMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export function daysBackFromDate(start: Date, now = new Date()) {
  const diffMs = Math.max(0, now.getTime() - start.getTime());
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function initialConnectScanWindow(now = new Date()) {
  const since = startOfCurrentMonth(now);
  return {
    since,
    daysBack: daysBackFromDate(since, now),
  };
}
