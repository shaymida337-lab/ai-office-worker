-- AlterTable
ALTER TABLE "SyncLog" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Align heartbeat with start time for historical rows so stuck recovery is deterministic.
UPDATE "SyncLog" SET "updatedAt" = "startedAt" WHERE "updatedAt" IS NOT NULL;
