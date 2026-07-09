-- Phase A foundation skeleton: global-safe organization locale fields.
ALTER TABLE "Organization"
ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'he',
ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'IL',
ADD COLUMN IF NOT EXISTS "date_format" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
ADD COLUMN IF NOT EXISTS "time_format" TEXT NOT NULL DEFAULT '24h',
ADD COLUMN IF NOT EXISTS "week_start" TEXT NOT NULL DEFAULT 'sunday',
ADD COLUMN IF NOT EXISTS "phone_country_code" TEXT NOT NULL DEFAULT '+972';
