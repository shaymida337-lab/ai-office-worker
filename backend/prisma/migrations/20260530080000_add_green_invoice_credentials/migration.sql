ALTER TABLE "Organization"
ADD COLUMN "greenInvoiceApiKeyId" TEXT,
ADD COLUMN "greenInvoiceApiSecret" TEXT,
ADD COLUMN "greenInvoiceEnv" TEXT DEFAULT 'sandbox',
ADD COLUMN "greenInvoiceConnectedAt" TIMESTAMP(3);
