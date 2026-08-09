-- Client insurance profile for insurance-agent module (phase 1).
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insuranceJson" JSONB;
