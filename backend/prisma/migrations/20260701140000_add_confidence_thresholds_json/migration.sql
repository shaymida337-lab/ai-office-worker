-- Phase 2.6 — configurable confidence gate thresholds per organization

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "confidence_thresholds_json" JSONB;
