import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("I18nProvider first paint is deterministic he (no localStorage during hydrate)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, "index.tsx"), "utf8");

  assert.match(src, /useState<AppLanguage>\("he"\)/);
  assert.doesNotMatch(src, /useState\(\(\)\s*=>\s*readStoredLanguage/);
  assert.match(src, /useEffect\(\(\)\s*=>\s*\{\s*const stored = readStoredLanguage\(\)/);
  assert.doesNotMatch(src, /suppressHydrationWarning/);
});
