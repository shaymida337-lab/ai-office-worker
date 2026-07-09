import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

type EmbeddedBuildInfo = {
  commitSha?: string | null;
  buildTime?: string | null;
};

export type BuildInfo = {
  commitSha: string | null;
  buildTime: string | null;
  serverStartedAt: string;
  version: string;
  nodeEnv: string | null;
  serviceName: string | null;
  serviceId: string | null;
  instanceId: string | null;
  renderExternalUrl: string | null;
  onRender: boolean;
};

let cachedEmbedded: EmbeddedBuildInfo | null | undefined;
let cachedPackageVersion: string | null = null;
const serverStartedAt = new Date().toISOString();

/** @internal test helper */
export function resetBuildInfoCacheForTests(): void {
  cachedEmbedded = undefined;
  cachedPackageVersion = null;
}

function readEmbeddedBuildInfo(): EmbeddedBuildInfo | null {
  if (cachedEmbedded !== undefined) return cachedEmbedded;

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "dist", "build-info.json"),
    join(moduleDir, "..", "build-info.json"),
    join(moduleDir, "../../dist", "build-info.json"),
    join(process.cwd(), "build-info.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      cachedEmbedded = JSON.parse(readFileSync(path, "utf8")) as EmbeddedBuildInfo;
      return cachedEmbedded;
    } catch {
      // try next candidate
    }
  }

  cachedEmbedded = null;
  return null;
}

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
  const embedded = readEmbeddedBuildInfo();
  const runtimeCommit = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null;
  const embeddedCommit = embedded?.commitSha ?? null;

  return {
    commitSha: runtimeCommit ?? embeddedCommit,
    buildTime: process.env.BUILD_TIME ?? embedded?.buildTime ?? null,
    serverStartedAt,
    version: readPackageVersion(),
    nodeEnv: process.env.NODE_ENV ?? null,
    serviceName: process.env.RENDER_SERVICE_NAME ?? null,
    serviceId: process.env.RENDER_SERVICE_ID ?? null,
    instanceId: process.env.RENDER_INSTANCE_ID ?? null,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    onRender: process.env.RENDER === "true",
  };
}

export function getHealthPayload(input: { status: "ok" | "error"; database: "connected" | "disconnected" }) {
  const build = getBuildInfo();
  return {
    status: input.status,
    database: input.database,
    commit: build.commitSha,
    version: build.version,
    buildTime: build.buildTime ?? build.serverStartedAt,
    serverStartedAt: build.serverStartedAt,
    nodeEnv: build.nodeEnv,
    serviceName: build.serviceName,
    serviceId: build.serviceId,
    instanceId: build.instanceId,
    renderUrl: build.renderExternalUrl,
    onRender: build.onRender,
    // Render does not inject a deploy-id env var at runtime; kept for manual/CI overrides.
    deployId: process.env.RENDER_DEPLOY_ID ?? null,
  };
}
