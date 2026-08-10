-- CreateTable
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "content_sha256" TEXT,
    "gmail_message_id" TEXT,
    "gmail_thread_id" TEXT,
    "gmail_attachment_id" TEXT,
    "whatsapp_log_id" TEXT,
    "drive_file_id" TEXT,
    "upload_id" TEXT,
    "original_filename" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_documents_organization_id_source_key_key" ON "source_documents"("organization_id", "source_key");

-- CreateIndex
CREATE INDEX "source_documents_organization_id_idx" ON "source_documents"("organization_id");

-- CreateIndex
CREATE INDEX "source_documents_content_sha256_idx" ON "source_documents"("content_sha256");

-- CreateIndex
CREATE INDEX "source_documents_gmail_message_id_idx" ON "source_documents"("gmail_message_id");

-- CreateIndex
CREATE INDEX "source_documents_drive_file_id_idx" ON "source_documents"("drive_file_id");
