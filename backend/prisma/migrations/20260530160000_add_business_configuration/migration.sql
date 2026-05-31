ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "business_type" TEXT NOT NULL DEFAULT 'service_business';
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "enabled_modules" JSONB NOT NULL DEFAULT '["crm","invoices","supplier_management","tasks","whatsapp","documents","collections"]'::jsonb;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "business_size" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "main_business_pain" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "onboarding_completed" BOOLEAN NOT NULL DEFAULT true;
