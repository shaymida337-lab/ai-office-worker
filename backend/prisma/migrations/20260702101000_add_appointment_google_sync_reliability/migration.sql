ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "googleSyncStatus" TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS "lastGoogleSyncError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastGoogleSyncAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "googleSyncAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextGoogleSyncRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Appointment_organizationId_googleSyncStatus_nextGoogleSyncRetryAt_idx"
  ON "Appointment"("organizationId", "googleSyncStatus", "nextGoogleSyncRetryAt");
