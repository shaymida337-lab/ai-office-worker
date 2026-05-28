import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaConnectPromise?: Promise<void>;
  prismaConnected?: boolean;
};

function databaseUrlWithSaferPoolSettings() {
  const raw = process.env.DATABASE_URL;
  if (!raw?.startsWith("postgres")) return raw;

  const url = new URL(raw);
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("connect_timeout", "10");
  url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "20");
  url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? "5");
  return url.toString();
}

export function databaseHost() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "missing";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(process.env.DATABASE_URL?.startsWith("postgres")
      ? { datasources: { db: { url: databaseUrlWithSaferPoolSettings() } } }
      : {}),
  });
}

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

globalForPrisma.prisma = prisma;

export function isPrismaConnected() {
  return Boolean(globalForPrisma.prismaConnected);
}

export async function connectPrisma() {
  if (globalForPrisma.prismaConnected) return;

  globalForPrisma.prismaConnectPromise ??= (async () => {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      globalForPrisma.prismaConnected = true;
      console.log(`PRISMA_CONNECTED host=${databaseHost()}`);
    } catch (err) {
      globalForPrisma.prismaConnected = false;
      console.error(`[prisma] Prisma connection failed host=${databaseHost()}`, err);
      throw err;
    }
  })().finally(() => {
    globalForPrisma.prismaConnectPromise = undefined;
  });

  return globalForPrisma.prismaConnectPromise;
}
