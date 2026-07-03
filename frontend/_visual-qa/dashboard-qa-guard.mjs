/** Dedicated production-like port for dashboard visual QA — avoids stale dev servers on 3000/3001. */
export const DASHBOARD_VISUAL_QA_PORT = 3011;

export const DASHBOARD_VISUAL_QA_BASE =
  process.env.VISUAL_QA_BASE ?? `http://localhost:${DASHBOARD_VISUAL_QA_PORT}`;

const SERVER_ERROR_MARKERS = [
  "Internal Server Error",
  "Cannot find module",
  "MODULE_NOT_FOUND",
];

export function isDashboardServerErrorBody(body) {
  const text = String(body ?? "");
  return SERVER_ERROR_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Fail fast before screenshot capture when the server is unhealthy (e.g. stale .next).
 */
export async function assertDashboardServerReady(base = DASHBOARD_VISUAL_QA_BASE) {
  const url = `${base.replace(/\/$/, "")}/dashboard`;
  let res;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (err) {
    throw new Error(
      `Dashboard server unreachable at ${url}. Start a clean production server: remove .next, npm run build, PORT=${DASHBOARD_VISUAL_QA_PORT} npm run start. (${err.message || err})`
    );
  }

  const body = await res.text();
  if (!res.ok || isDashboardServerErrorBody(body)) {
    throw new Error(
      `Dashboard server unhealthy at ${url} (HTTP ${res.status}). ` +
        `Likely stale .next cache. Remove frontend/.next, run npm run build, then PORT=${DASHBOARD_VISUAL_QA_PORT} npm run start.`
    );
  }

  return { ok: true, url, status: res.status };
}
