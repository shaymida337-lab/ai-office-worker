DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'FinancialDocumentReview'
      AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "FinancialDocumentReview"
      ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('"FinancialDocumentReview_organizationId_documentFingerprint_key"') IS NOT NULL
     AND to_regclass('"FDR_org_documentFingerprint_key"') IS NULL THEN
    ALTER INDEX "FinancialDocumentReview_organizationId_documentFingerprint_key"
      RENAME TO "FDR_org_documentFingerprint_key";
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('"FinancialDocumentReview_organizationId_reviewStatus_createdAt_i"') IS NOT NULL
     AND to_regclass('"FDR_org_reviewStatus_createdAt_idx"') IS NULL THEN
    ALTER INDEX "FinancialDocumentReview_organizationId_reviewStatus_createdAt_i"
      RENAME TO "FDR_org_reviewStatus_createdAt_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('"FinancialDocumentReview_organizationId_source_createdAt_idx"') IS NOT NULL
     AND to_regclass('"FDR_org_source_createdAt_idx"') IS NULL THEN
    ALTER INDEX "FinancialDocumentReview_organizationId_source_createdAt_idx"
      RENAME TO "FDR_org_source_createdAt_idx";
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('"FinancialDocumentReview_organizationId_sourceFingerprint_idx"') IS NOT NULL
     AND to_regclass('"FDR_org_sourceFingerprint_idx"') IS NULL THEN
    ALTER INDEX "FinancialDocumentReview_organizationId_sourceFingerprint_idx"
      RENAME TO "FDR_org_sourceFingerprint_idx";
  END IF;
END $$;
