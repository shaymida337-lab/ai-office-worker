-- Make client email optional and mark legacy Natalie placeholder addresses.
ALTER TABLE "Client" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "emailIsPlaceholder" BOOLEAN NOT NULL DEFAULT false;

-- Preserve customers: clear synthetic scheduling placeholders instead of deleting rows.
UPDATE "Client"
SET
  "email" = NULL,
  "emailIsPlaceholder" = true
WHERE "email" IS NOT NULL
  AND LOWER("email") LIKE '%@scheduling.local';
