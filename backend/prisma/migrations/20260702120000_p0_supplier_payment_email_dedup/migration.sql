-- P0-003: one active SupplierPayment per email message per organization.
-- Reject younger duplicate twins so partial unique index can be created safely.

UPDATE "SupplierPayment" sp
SET
  "approvalStatus" = 'rejected',
  "duplicateDetected" = true,
  "duplicateReason" = COALESCE("duplicateReason", 'p0_migration_email_message_dedup'),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE sp.id IN (
  SELECT younger.id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "organizationId", "emailMessageId"
        ORDER BY "createdAt" ASC, id ASC
      ) AS rn
    FROM "SupplierPayment"
    WHERE "emailMessageId" IS NOT NULL
      AND "approvalStatus" <> 'rejected'
  ) younger
  WHERE younger.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPayment_organizationId_emailMessageId_active_key"
ON "SupplierPayment" ("organizationId", "emailMessageId")
WHERE "emailMessageId" IS NOT NULL AND "approvalStatus" <> 'rejected';
