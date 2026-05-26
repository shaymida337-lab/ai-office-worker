-- Add metadata needed by the Gmail scanner.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "firstSeen" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMP(3);

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "gmailMessageId" TEXT;

CREATE INDEX IF NOT EXISTS "Client_organizationId_domain_idx" ON "Client"("organizationId", "domain");
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_gmailMessageId_idx" ON "Invoice"("organizationId", "gmailMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_gmailMessageId_key" ON "Invoice"("organizationId", "gmailMessageId") WHERE "gmailMessageId" IS NOT NULL;
