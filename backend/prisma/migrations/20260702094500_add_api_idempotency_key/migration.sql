CREATE TABLE IF NOT EXISTS "ApiIdempotencyKey" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "statusCode" INTEGER,
  "responseBodyJson" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiIdempotencyKey_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ApiIdempotencyKey"
    ADD CONSTRAINT "ApiIdempotencyKey_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ApiIdempotencyKey_organizationId_routeKey_idempotencyKey_key"
  ON "ApiIdempotencyKey"("organizationId", "routeKey", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "ApiIdempotencyKey_organizationId_createdAt_idx"
  ON "ApiIdempotencyKey"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "ApiIdempotencyKey_organizationId_routeKey_createdAt_idx"
  ON "ApiIdempotencyKey"("organizationId", "routeKey", "createdAt");
