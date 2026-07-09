import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "dist", "build-info.json");

const payload = {
  commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
  buildTime: process.env.BUILD_TIME ?? new Date().toISOString(),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[embed-build-info] wrote ${outPath} commit=${payload.commitSha ?? "null"}`);
