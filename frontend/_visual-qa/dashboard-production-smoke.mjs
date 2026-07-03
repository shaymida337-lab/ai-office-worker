/**
 * Phase 8 — production smoke: clean build, dedicated port 3011, dashboard visual QA.
 *
 * Usage (from frontend/):
 *   node _visual-qa/dashboard-production-smoke.mjs
 *
 * Skips rebuild when VISUAL_QA_SKIP_BUILD=1 (server must already be on port 3011).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import {
  DASHBOARD_VISUAL_QA_BASE,
  DASHBOARD_VISUAL_QA_PORT,
  assertDashboardServerReady,
} from "./dashboard-qa-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.join(__dirname, "..");
const NEXT_DIR = path.join(FRONTEND_ROOT, ".next");

function run(command, args, { env = {}, background = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: FRONTEND_ROOT,
      env: { ...process.env, ...env },
      stdio: background ? "ignore" : "inherit",
      shell: true,
      detached: background,
    });

    if (background) {
      child.unref();
      resolve(child);
      return;
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function waitForServer(base, attempts = 60, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await assertDashboardServerReady(base);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError ?? new Error(`Server not ready at ${base}`);
}

async function main() {
  const skipBuild = process.env.VISUAL_QA_SKIP_BUILD === "1";
  let serverProcess = null;

  console.log(`[smoke] base=${DASHBOARD_VISUAL_QA_BASE} port=${DASHBOARD_VISUAL_QA_PORT}`);

  if (!skipBuild) {
    if (fs.existsSync(NEXT_DIR)) {
      console.log("[smoke] removing stale .next …");
      await rm(NEXT_DIR, { recursive: true, force: true });
    }
    console.log("[smoke] npm run build …");
    await run("npm", ["run", "build"]);
    console.log(`[smoke] starting production server on port ${DASHBOARD_VISUAL_QA_PORT} …`);
    serverProcess = await run("npm", ["run", "start"], {
      env: { PORT: String(DASHBOARD_VISUAL_QA_PORT) },
      background: true,
    });
    await waitForServer(DASHBOARD_VISUAL_QA_BASE);
  } else {
    console.log("[smoke] VISUAL_QA_SKIP_BUILD=1 — checking existing server …");
    await assertDashboardServerReady(DASHBOARD_VISUAL_QA_BASE);
  }

  process.env.VISUAL_QA_BASE = DASHBOARD_VISUAL_QA_BASE;
  console.log("[smoke] running dashboard visual QA …");
  await run("node", ["_visual-qa/dashboard-phase7-compare.mjs"]);

  if (serverProcess?.pid) {
    try {
      process.kill(serverProcess.pid);
    } catch {
      // ignore if already stopped
    }
  }

  console.log("[smoke] pass");
}

main().catch((err) => {
  console.error("[smoke] fail:", err.message || err);
  process.exitCode = 1;
});
