"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold">התרחשה תקלה כללית</h2>
          <p className="mt-3 text-sm text-slate-600">התקלה דווחה אוטומטית. ניתן לנסות שוב.</p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            נסה שוב
          </button>
        </div>
      </body>
    </html>
  );
}
