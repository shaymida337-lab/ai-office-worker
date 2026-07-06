import { readFileSync } from "fs";
import { join } from "path";

export type BuildInfo = {
  commitSha: string | null;
  deployId: string | null;
  version: string;
  buildTime: string | null;
};

let cachedPackageVersion: string | null = null;
const serverStartedAt = new Date().toISOString();

function readPackageVersion(): string {
  if (cachedPackageVersion) return cachedPackageVersion;
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    cachedPackageVersion = typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    cachedPackageVersion = "0.0.0";
  }
  return cachedPackageVersion;
}

export function getBuildInfo(): BuildInfo {
  return {
    commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
    deployId: process.env.RENDER_DEPLOY_ID ?? null,
    version: readPackageVersion(),
    buildTime: process.env.BUILD_TIME ?? serverStartedAt,
  };
}

export function getHealthPayload(input: { status: "ok" | "error"; database: "connected" | "disconnected" }) {
  const build = getBuildInfo();
  return {
    status: input.status,
    database: input.database,
    commit: build.commitSha,
    version: build.version,
    deployId: build.deployId,
    buildTime: build.buildTime ?? new Date().toISOString(),
  };
}
