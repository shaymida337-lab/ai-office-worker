import { spawn } from "node:child_process";

const maxAttempts = Number(process.env.PRISMA_MIGRATE_DEPLOY_ATTEMPTS ?? 12);
const retryDelayMs = Number(process.env.PRISMA_MIGRATE_DEPLOY_RETRY_MS ?? 15000);

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`[migrate-deploy] attempt ${attempt}/${maxAttempts}`);
  const result = await runPrismaMigrateDeploy();
  if (result.code === 0) {
    console.log("[migrate-deploy] migrations applied successfully");
    process.exit(0);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const advisoryLockTimedOut = /advisory lock|P1002|Timed out trying to acquire/i.test(output);
  if (!advisoryLockTimedOut || attempt === maxAttempts) {
    console.error("[migrate-deploy] migration failed without retryable advisory lock condition");
    process.exit(result.code ?? 1);
  }

  console.warn(`[migrate-deploy] postgres advisory lock is busy; retrying in ${retryDelayMs}ms`);
  await delay(retryDelayMs);
}

function runPrismaMigrateDeploy() {
  return new Promise((resolve) => {
    const child = spawn("npx", ["prisma", "migrate", "deploy"], {
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
