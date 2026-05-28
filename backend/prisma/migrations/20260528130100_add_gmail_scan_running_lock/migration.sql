UPDATE "SyncLog"
SET "status" = 'error',
    "errorMessage" = COALESCE("errorMessage", 'Running Gmail scan was closed during deployment lock migration'),
    "finishedAt" = COALESCE("finishedAt", NOW())
WHERE "type" = 'gmail_scan'
  AND "status" = 'running'
  AND "finishedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SyncLog_one_running_gmail_scan_per_org_idx"
ON "SyncLog"("organizationId")
WHERE "type" = 'gmail_scan'
  AND "status" = 'running'
  AND "finishedAt" IS NULL;
