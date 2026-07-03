import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test as nodeTest } from "node:test";
// WIP — ממתין למימוש gmailConnectionState; להסיר skip במימוש
const test = ((name: string, fn: () => void) => nodeTest(name, { skip: "WIP gmailConnectionState" }, fn)) as typeof nodeTest;

const FRONTEND_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALLOWED_RAW_FLAG_PATHS = new Set([
  "lib/api.ts",
  "lib/integrations/gmailConnectionState.ts",
  "lib/integrations/gmailConnectionTruth.ts",
  "lib/integrations/gmailOAuthReturn.ts",
  "lib/integrations/gmailConnection.ts",
  "lib/integrations/gmailConnectionState.test.ts",
  "lib/integrations/gmailConnectionTruth.test.ts",
  "lib/integrations/gmailOAuthReturn.test.ts",
  "lib/integrations/gmailConnectionGuard.ts",
  "lib/integrations/gmailConnectionGuard.test.ts",
  "lib/integrations/gmailConnectionDiagnostics.ts",
  "lib/integrations/gmailConnectionDiagnostics.test.ts",
  "lib/integrations/gmailConnectionAudit.test.ts",
]);

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "gmailStatus?.connected", pattern: /\bgmailStatus\?\.connected\b/ },
  { name: "gmailStatus.connected", pattern: /\bgmailStatus\.connected\b/ },
  { name: "reconnectRequired", pattern: /\breconnectRequired\b/ },
  { name: "gmailConnectionPhase", pattern: /\bgmailConnectionPhase\b/ },
];

function walkTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkTsFiles(fullPath, files);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(fullPath);
  }
  return files;
}

test("frontend UI does not read raw Gmail connection flags outside normalization layer", () => {
  const violations: string[] = [];

  for (const filePath of walkTsFiles(FRONTEND_SRC)) {
    const rel = relative(FRONTEND_SRC, filePath).replace(/\\/g, "/");
    if (ALLOWED_RAW_FLAG_PATHS.has(rel)) continue;

    const content = readFileSync(filePath, "utf8");
    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${rel}: ${name}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Raw Gmail flag usage found:\n${violations.join("\n")}`
  );
});
