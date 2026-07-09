-- Phase A shadow tracking for long-running jobs.
CREATE TABLE "JobRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "jobType" TEXT NOT NULL,
  "referenceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "timeoutAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 0,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JobRun_status_timeoutAt_idx" ON "JobRun"("status", "timeoutAt");
CREATE INDEX "JobRun_organizationId_jobType_status_idx" ON "JobRun"("organizationId", "jobType", "status");
CREATE INDEX "JobRun_jobType_startedAt_idx" ON "JobRun"("jobType", "startedAt");
CREATE INDEX "JobRun_jobType_referenceId_status_idx" ON "JobRun"("jobType", "referenceId", "status");

ALTER TABLE "JobRun"
ADD CONSTRAINT "JobRun_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
