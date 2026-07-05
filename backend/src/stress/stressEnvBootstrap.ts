/** Must be imported before any module that initializes Prisma. */
process.env.PRISMA_CONNECTION_LIMIT = process.env.PRISMA_CONNECTION_LIMIT ?? "120";
process.env.PRISMA_POOL_TIMEOUT = process.env.PRISMA_POOL_TIMEOUT ?? "60";
process.env.PRISMA_TRANSACTION_MAX_WAIT_MS = process.env.PRISMA_TRANSACTION_MAX_WAIT_MS ?? "120000";
process.env.PRISMA_TRANSACTION_TIMEOUT_MS = process.env.PRISMA_TRANSACTION_TIMEOUT_MS ?? "120000";
