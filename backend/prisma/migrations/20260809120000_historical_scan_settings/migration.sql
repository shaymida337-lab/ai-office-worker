-- Historical Scan Depth onboarding feature: tenant-level scan settings.
ALTER TABLE "Organization" ADD COLUMN "historical_scan_years" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Organization" ADD COLUMN "initial_backfill_completed" BOOLEAN NOT NULL DEFAULT false;
