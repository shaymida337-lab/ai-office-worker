// Build ה-backend ב-esbuild (transpile לכל קובץ, ללא type-checking):
// tsc נופל ב-out-of-memory על מכונת ה-build של Render — ה-binding של
// ~3,000 קבצי d.ts (בעיקר Prisma) דורש יותר RAM משיש למכונה, גם עם
// --noCheck. esbuild מתרגם קובץ-קובץ בזיכרון זניח ומפיק את אותו CJS
// (target ES2022, esModuleInterop). בדיקת טיפוסים מלאה: `npm run typecheck`.
import { build } from "esbuild";
import { globSync } from "node:fs";
import { rmSync } from "node:fs";

const EXCLUDED = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.stress\.test\.ts$/,
  /\.smoke\.test\.ts$/,
  /\/__tests__\//,
  /\/stress\//,
  /\/fixtures\//,
  /\/examples\//,
  /\/mocks\//,
  /\/snapshots\//,
];

const entryPoints = globSync("src/**/*.ts").filter(
  (file) => !EXCLUDED.some((pattern) => pattern.test(file.replaceAll("\\", "/")))
);

if (entryPoints.length === 0) {
  console.error("[build] no source files found under src/");
  process.exit(1);
}

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints,
  outdir: "dist",
  outbase: "src",
  platform: "node",
  format: "cjs",
  target: "es2022",
  sourcemap: false,
  logLevel: "warning",
});

console.log(`[build] esbuild transpiled ${entryPoints.length} files -> dist/`);
