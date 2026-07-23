import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

test("useGlobalHeaderProfile first paint does not read localStorage for userName", () => {
  const src = fs.readFileSync(path.join(dir, "useGlobalHeaderProfile.ts"), "utf8");
  assert.match(src, /useState\(initial\?\.userName \?\? "שלום"\)/);
  assert.doesNotMatch(src, /useState\(\(\)\s*=>\s*initial\?\.userName \|\| readLocalUserName/);
  assert.match(src, /readLocalUserName\(\)/);
  assert.match(src, /useEffect\(/);
});

test("root layout does not run pre-hydrate localStorage script on html attrs", () => {
  const layoutPath = path.join(dir, "../app/layout.tsx");
  const src = fs.readFileSync(layoutPath, "utf8");
  assert.match(src, /className="dark"/);
  assert.doesNotMatch(src, /localStorage\.getItem\('natalie-theme'\)/);
  assert.doesNotMatch(src, /localStorage\.getItem\('natalie-language'\)/);
  assert.doesNotMatch(src, /suppressHydrationWarning/);
});
