export function errorDetails(err: unknown) {
  if (err instanceof Error) {
    const maybe = err as Error & {
      code?: string;
      status?: number;
      response?: { status?: number; statusText?: string; data?: unknown };
      meta?: unknown;
    };
    return {
      name: err.name,
      message: err.message,
      code: maybe.code,
      status: maybe.status ?? maybe.response?.status,
      statusText: maybe.response?.statusText,
      responseData: maybe.response?.data,
      meta: maybe.meta,
      stack: err.stack,
    };
  }

  return { message: String(err) };
}

export function publicErrorMessage(err: unknown): string {
  const details = errorDetails(err);
  return [details.name, details.code, details.status, details.message]
    .filter(Boolean)
    .join(": ");
}
