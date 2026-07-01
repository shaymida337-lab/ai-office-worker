-- P0-003: one active SupplierPayment per email message per organization (Gmail-sourced).
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierPayment_organizationId_emailMessageId_active_key"
ON "SupplierPayment" ("organizationId", "emailMessageId")
WHERE "emailMessageId" IS NOT NULL AND "approvalStatus" <> 'rejected';
