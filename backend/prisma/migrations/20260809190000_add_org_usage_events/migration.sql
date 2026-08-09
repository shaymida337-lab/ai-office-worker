-- Passive org-scoped cost metering (shadow / passive).
CREATE TYPE "OrgUsageProvider" AS ENUM (
  'ANTHROPIC',
  'OPENAI_WHISPER',
  'OPENAI_TTS',
  'ELEVENLABS',
  'TWILIO',
  'GOOGLE'
);

CREATE TABLE "org_usage_events" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "provider" "OrgUsageProvider" NOT NULL,
  "feature" TEXT NOT NULL,
  "units" DOUBLE PRECISION NOT NULL,
  "estimated_cost_usd" DECIMAL(10,6) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_usage_events_org_id_created_at_idx" ON "org_usage_events"("org_id", "created_at");
CREATE INDEX "org_usage_events_created_at_idx" ON "org_usage_events"("created_at");

ALTER TABLE "org_usage_events"
  ADD CONSTRAINT "org_usage_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
