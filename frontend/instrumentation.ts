import * as Sentry from "@sentry/nextjs";

function initSentry() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  const environment = process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "development";
  const commit = process.env.RENDER_GIT_COMMIT ?? process.env.NEXT_PUBLIC_APP_COMMIT;

  if (!dsn) {
    return;
  }

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

export async function register() {
  initSentry();
}

export const onRequestError = Sentry.captureRequestError;
