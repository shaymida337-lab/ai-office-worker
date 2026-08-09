/**
 * Public liveness vs readiness helpers.
 * /health must never query PostgreSQL (Render + frontend warmup poll it).
 * /ready may probe the DB for ops only — never wire Render healthCheckPath to it.
 */

export type HealthPayloadFactory = (input: {
  status: "ok" | "error";
  database: "connected" | "disconnected";
}) => Record<string, unknown>;

/** Process/app liveness — no Prisma / SQL. */
export function buildLivenessHealthPayload(
  getHealthPayload: HealthPayloadFactory,
  isPrismaConnected: () => boolean
) {
  return getHealthPayload({
    status: "ok",
    database: isPrismaConnected() ? "connected" : "disconnected",
  });
}
