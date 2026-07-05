CREATE TABLE IF NOT EXISTS "NatalieConfirmationExecution" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "turnId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "ok" BOOLEAN,
  "resultMessage" TEXT,
  "resultPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "NatalieConfirmationExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NatalieConfirmationExecution_confirmationId_key"
  ON "NatalieConfirmationExecution"("confirmationId");

CREATE INDEX IF NOT EXISTS "NatalieConfirmationExecution_organizationId_userId_idx"
  ON "NatalieConfirmationExecution"("organizationId", "userId");

CREATE INDEX IF NOT EXISTS "NatalieConfirmationExecution_sessionId_idx"
  ON "NatalieConfirmationExecution"("sessionId");

CREATE INDEX IF NOT EXISTS "NatalieConfirmationExecution_organizationId_userId_turnId_idx"
  ON "NatalieConfirmationExecution"("organizationId", "userId", "turnId");
