-- Natalie Reliability Center V1: persistent aggregated production incident store

CREATE TABLE IF NOT EXISTS "reliability_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT,
  "module" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "errorCode" TEXT NOT NULL,
  "userVisibleMessage" TEXT,
  "technicalMessage" TEXT,
  "route" TEXT,
  "component" TEXT,
  "job" TEXT,
  "correlationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "fingerprint" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "autoHealed" BOOLEAN NOT NULL DEFAULT false,
  "customerVisible" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reliability_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reliability_events_organizationId_fkey'
  ) THEN
    ALTER TABLE "reliability_events"
      ADD CONSTRAINT "reliability_events_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "reliability_events_fingerprint_status_idx"
  ON "reliability_events"("fingerprint", "status");
CREATE INDEX IF NOT EXISTS "reliability_events_org_status_lastSeen_idx"
  ON "reliability_events"("organizationId", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "reliability_events_org_module_status_idx"
  ON "reliability_events"("organizationId", "module", "status");
CREATE INDEX IF NOT EXISTS "reliability_events_severity_status_lastSeen_idx"
  ON "reliability_events"("severity", "status", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "reliability_events_errorCode_status_idx"
  ON "reliability_events"("errorCode", "status");
CREATE INDEX IF NOT EXISTS "reliability_events_customer_visible_idx"
  ON "reliability_events"("customerVisible", "status", "lastSeenAt");

-- At most one open incident per fingerprint (new open allowed after resolve).
CREATE UNIQUE INDEX IF NOT EXISTS "reliability_events_open_fingerprint_unique"
  ON "reliability_events"("fingerprint")
  WHERE "status" = 'open';
