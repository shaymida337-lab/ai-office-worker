-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_emailMessageId_key" ON "Task"("organizationId", "emailMessageId");
