import { existsSync, readFileSync } from "fs";
import { join } from "path";
import * as Sentry from "@sentry/node";

function resolveCommitSha(): string | null {
  const runtime = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null;
  if (runtime) return runtime;

  const candidates = [
    join(process.cwd(), "dist", "build-info.json"),
    join(__dirname, "..", "build-info.json"),
    join(__dirname, "../../dist", "build-info.json"),
    join(process.cwd(), "backend", "dist", "build-info.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const embedded = JSON.parse(readFileSync(path, "utf8")) as { commitSha?: string | null };
      if (embedded.commitSha) return embedded.commitSha;
    } catch {
      // try next candidate
    }
  }

  return null;
}

const environment = process.env.NODE_ENV ?? "development";
const commitSha = resolveCommitSha();

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://3a747402b605ed3abffa2e79eafb556e@o4511704861573120.ingest.de.sentry.io/4511704897355856",
  environment,
});

Sentry.setTag("service", "backend");
if (commitSha) {
  Sentry.setTag("commit", commitSha);
}
