ALTER TABLE "SyncLog"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT;

CREATE INDEX IF NOT EXISTS "SyncLog_client_type_status_finishedAt_idx"
ON "SyncLog"("clientId", "type", "status", "finishedAt");

UPDATE "SyncLog"
SET "status" = 'error',
    "errorMessage" = COALESCE("errorMessage", 'Running client invoice scan was closed during deployment lock migration'),
    "finishedAt" = COALESCE("finishedAt", NOW())
WHERE "type" = 'client_invoice_scan'
  AND "status" = 'running'
  AND "finishedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SyncLog_one_running_client_invoice_scan_idx"
ON "SyncLog"("clientId")
WHERE "type" = 'client_invoice_scan'
  AND "status" = 'running'
  AND "finishedAt" IS NULL
  AND "clientId" IS NOT NULL;
