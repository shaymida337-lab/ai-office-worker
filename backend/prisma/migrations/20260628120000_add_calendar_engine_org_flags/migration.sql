-- Org-level Calendar Engine pilot flags (global env flags remain kill switches).
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "calendar_engine_read_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "calendar_engine_write_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "calendar_engine_google_mirror_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "calendar_engine_pilot_notes" TEXT;
