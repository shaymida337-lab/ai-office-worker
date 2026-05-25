-- CreateTable
CREATE TABLE "ClientWhatsApp" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "sessionData" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "messagesScanned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientWhatsApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "body" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "hasInvoice" BOOLEAN NOT NULL DEFAULT false,
    "hasTask" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientWhatsApp_clientId_key" ON "ClientWhatsApp"("clientId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_clientId_timestamp_idx" ON "WhatsAppMessage"("clientId", "timestamp");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_clientId_processed_idx" ON "WhatsAppMessage"("clientId", "processed");

-- AddForeignKey
ALTER TABLE "ClientWhatsApp" ADD CONSTRAINT "ClientWhatsApp_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
