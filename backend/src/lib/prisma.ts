import { PrismaClient } from "@prisma/client";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECTABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1017", "P2024"]);

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function databaseUrlWithSaferPoolSettings() {
  const raw = process.env.DATABASE_URL;
  if (!raw?.startsWith("postgres")) return raw;

  const url = new URL(raw);
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("connect_timeout", "10");
  url.searchParams.set("pool_timeout", "10");
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

function isReconnectablePrismaError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    RECONNECTABLE_PRISMA_CODES.has(code) ||
    /terminating connection due to administrator command|server closed the connection unexpectedly|connection terminated|connection.*closed|socket closed|can't reach database server/i.test(message)
  );
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(process.env.DATABASE_URL?.startsWith("postgres")
      ? { datasources: { db: { url: databaseUrlWithSaferPoolSettings() } } }
      : {}),
  });

  let reconnectPromise: Promise<void> | null = null;

  async function reconnect() {
    reconnectPromise ??= (async () => {
      console.warn("[prisma] PostgreSQL connection was closed; reconnecting...");
      await base.$disconnect().catch(() => undefined);
      await sleep(250);
      await base.$connect();
      console.warn("[prisma] PostgreSQL reconnected");
    })().finally(() => {
      reconnectPromise = null;
    });

    return reconnectPromise;
  }

  async function withReconnectRetry<T>(operation: string, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (!isReconnectablePrismaError(error) || attempt === MAX_RECONNECT_ATTEMPTS) {
          throw error;
        }

        console.warn(`[prisma] ${operation} failed because the DB connection closed. Reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS - 1}`);
        await reconnect();
        await sleep(attempt * 200);
      }
    }

    return run();
  }

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return withReconnectRetry(`${model}.${operation}`, () => query(args));
        },
      },
      async $queryRaw({ args, query }) {
        return withReconnectRetry("$queryRaw", () => query(args));
      },
      async $queryRawUnsafe({ args, query }) {
        return withReconnectRetry("$queryRawUnsafe", () => query(args));
      },
      async $executeRaw({ args, query }) {
        return withReconnectRetry("$executeRaw", () => query(args));
      },
      async $executeRawUnsafe({ args, query }) {
        return withReconnectRetry("$executeRawUnsafe", () => query(args));
      },
    },
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
