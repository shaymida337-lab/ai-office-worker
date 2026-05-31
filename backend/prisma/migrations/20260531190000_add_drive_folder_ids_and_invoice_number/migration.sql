ALTER TABLE "EmailAttachment"
  ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveClientFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveSupplierFolderId" TEXT;

ALTER TABLE "SupplierPayment"
  ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveClientFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveSupplierFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveClientFolderId" TEXT,
  ADD COLUMN IF NOT EXISTS "driveSupplierFolderId" TEXT;
