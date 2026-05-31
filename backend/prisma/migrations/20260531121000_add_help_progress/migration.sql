CREATE TABLE "HelpProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "pageKey" TEXT NOT NULL,
  "itemType" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL DEFAULT 'main',
  "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HelpProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HelpProgress_userId_pageKey_itemType_itemKey_key"
  ON "HelpProgress"("userId", "pageKey", "itemType", "itemKey");

CREATE INDEX "HelpProgress_organizationId_pageKey_idx"
  ON "HelpProgress"("organizationId", "pageKey");

CREATE INDEX "HelpProgress_userId_completed_idx"
  ON "HelpProgress"("userId", "completed");

ALTER TABLE "HelpProgress"
  ADD CONSTRAINT "HelpProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HelpProgress"
  ADD CONSTRAINT "HelpProgress_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
