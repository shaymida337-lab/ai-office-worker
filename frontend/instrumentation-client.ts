import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development";
const commit = process.env.NEXT_PUBLIC_APP_COMMIT;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release: commit,
    tracesSampleRate: 0,
  });

  Sentry.setTag("service", "frontend");
  if (commit) {
    Sentry.setTag("commit", commit);
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
