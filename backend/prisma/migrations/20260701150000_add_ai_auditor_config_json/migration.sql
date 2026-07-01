-- Phase 2.7 — AI Auditor configuration per organization

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "ai_auditor_config_json" JSONB;
