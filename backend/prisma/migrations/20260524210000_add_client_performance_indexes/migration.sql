CREATE INDEX IF NOT EXISTS "EmailMessage_organizationId_processedAt_idx" ON "EmailMessage"("organizationId", "processedAt");
CREATE INDEX IF NOT EXISTS "SupplierPayment_clientId_paid_idx" ON "SupplierPayment"("clientId", "paid");
CREATE INDEX IF NOT EXISTS "Task_organizationId_status_idx" ON "Task"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Task_organizationId_createdAt_idx" ON "Task"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Task_clientId_status_idx" ON "Task"("clientId", "status");
CREATE INDEX IF NOT EXISTS "SyncLog_organizationId_type_status_finishedAt_idx" ON "SyncLog"("organizationId", "type", "status", "finishedAt");
