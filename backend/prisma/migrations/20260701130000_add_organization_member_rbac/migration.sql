-- Phase 2.5 — organization RBAC memberships

CREATE TABLE IF NOT EXISTS "OrganizationMember" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMember_organizationId_userId_key"
  ON "OrganizationMember"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_userId_idx"
  ON "OrganizationMember"("userId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_organizationId_role_idx"
  ON "OrganizationMember"("organizationId", "role");

DO $$ BEGIN
  ALTER TABLE "OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill existing org owners as owner role members.
INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
SELECT
  'mbr_' || o."id",
  o."id",
  o."userId",
  'owner',
  NOW(),
  NOW()
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "OrganizationMember" m
  WHERE m."organizationId" = o."id" AND m."userId" = o."userId"
);
