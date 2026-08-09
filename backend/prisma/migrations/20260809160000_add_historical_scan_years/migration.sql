-- Organization setting: historical Gmail scan depth (1–5 years).
ALTER TABLE "Organization"
ADD COLUMN IF NOT EXISTS "historical_scan_years" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Organization"
DROP CONSTRAINT IF EXISTS "Organization_historical_scan_years_check";

ALTER TABLE "Organization"
ADD CONSTRAINT "Organization_historical_scan_years_check"
CHECK ("historical_scan_years" >= 1 AND "historical_scan_years" <= 5);
