import { spawnSync } from "node:child_process";
import fs from "node:fs";

const mode = process.argv[2] === "off" ? "off" : "on";

if (fs.existsSync(".next")) {
  fs.rmSync(".next", { recursive: true, force: true });
}

const env = {
  ...process.env,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  NEXT_PUBLIC_CALENDAR_ENGINE_V1_READ: mode === "on" ? "true" : "false",
  NEXT_PUBLIC_CALENDAR_ENGINE_V1_WRITE: mode === "on" ? "true" : "false",
};

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env,
  shell: true,
});

process.exit(result.status ?? 1);
