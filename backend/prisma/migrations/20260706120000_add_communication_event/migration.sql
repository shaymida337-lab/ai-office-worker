CREATE TABLE IF NOT EXISTS "CommunicationEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "externalMessageId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "sender" TEXT,
  "recipient" TEXT,
  "subject" TEXT,
  "bodyPreview" TEXT,
  "metadataJson" JSONB,
  "sourceReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationEvent_organizationId_channel_externalMessageId_key"
  ON "CommunicationEvent"("organizationId", "channel", "externalMessageId");

CREATE INDEX IF NOT EXISTS "CommunicationEvent_organizationId_createdAt_idx"
  ON "CommunicationEvent"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "CommunicationEvent_organizationId_correlationId_idx"
  ON "CommunicationEvent"("organizationId", "correlationId");

CREATE INDEX IF NOT EXISTS "CommunicationEvent_organizationId_channel_idx"
  ON "CommunicationEvent"("organizationId", "channel");

CREATE INDEX IF NOT EXISTS "CommunicationEvent_externalMessageId_idx"
  ON "CommunicationEvent"("externalMessageId");

ALTER TABLE "CommunicationEvent"
  ADD CONSTRAINT "CommunicationEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
