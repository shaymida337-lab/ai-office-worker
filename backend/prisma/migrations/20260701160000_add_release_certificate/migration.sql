-- Phase 2.8 — Release Certificate history

CREATE TABLE IF NOT EXISTS "ReleaseCertificateRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "certificateId" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commitHash" TEXT,
  "deployId" TEXT,
  "environment" TEXT NOT NULL,
  "overallStatus" TEXT NOT NULL,
  "overallScore" DOUBLE PRECISION NOT NULL,
  "gate_results_json" JSONB NOT NULL,
  "failed_gates_json" JSONB NOT NULL,
  "warning_gates_json" JSONB NOT NULL,
  "releaseRecommendation" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "certificate_json" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseCertificateRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReleaseCertificateRecord_certificateId_key"
  ON "ReleaseCertificateRecord"("certificateId");

CREATE INDEX IF NOT EXISTS "ReleaseCertificateRecord_organizationId_timestamp_idx"
  ON "ReleaseCertificateRecord"("organizationId", "timestamp");

CREATE INDEX IF NOT EXISTS "ReleaseCertificateRecord_organizationId_overallStatus_idx"
  ON "ReleaseCertificateRecord"("organizationId", "overallStatus");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReleaseCertificateRecord_organizationId_fkey'
  ) THEN
    ALTER TABLE "ReleaseCertificateRecord"
      ADD CONSTRAINT "ReleaseCertificateRecord_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
