ALTER TABLE "WhatsAppLog"
  ADD COLUMN "providerMessageSid" TEXT,
  ADD COLUMN "mediaCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mediaJson" JSONB;

CREATE INDEX "WhatsAppLog_organizationId_direction_mediaCount_idx"
  ON "WhatsAppLog"("organizationId", "direction", "mediaCount");

CREATE INDEX "WhatsAppLog_organizationId_providerMessageSid_idx"
  ON "WhatsAppLog"("organizationId", "providerMessageSid");
