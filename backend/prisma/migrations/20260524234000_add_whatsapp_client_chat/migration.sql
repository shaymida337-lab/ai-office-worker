ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;
ALTER TABLE "WhatsAppLog" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "WhatsAppLog" ADD COLUMN IF NOT EXISTS "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppLog" ADD COLUMN IF NOT EXISTS "read" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Client_organizationId_whatsappNumber_idx" ON "Client"("organizationId", "whatsappNumber");
CREATE INDEX IF NOT EXISTS "WhatsAppLog_organizationId_clientId_createdAt_idx" ON "WhatsAppLog"("organizationId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppLog_clientId_read_idx" ON "WhatsAppLog"("clientId", "read");

ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "WhatsAppLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
