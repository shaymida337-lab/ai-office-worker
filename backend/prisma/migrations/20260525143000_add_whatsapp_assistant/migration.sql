-- CreateTable
CREATE TABLE "WhatsAppAssistant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "morningReportTime" TEXT NOT NULL DEFAULT '07:30',
    "clientDailyTime" TEXT NOT NULL DEFAULT '08:00',
    "language" TEXT NOT NULL DEFAULT 'he',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppAssistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "phone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WhatsAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "clientId" TEXT,
    "messages" JSONB NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerMorningReport" BOOLEAN NOT NULL DEFAULT true,
    "ownerMorningTime" TEXT NOT NULL DEFAULT '07:30',
    "ownerCriticalAlerts" BOOLEAN NOT NULL DEFAULT true,
    "clientMorningSummary" BOOLEAN NOT NULL DEFAULT true,
    "clientMorningTime" TEXT NOT NULL DEFAULT '08:00',
    "clientPaymentReminder" BOOLEAN NOT NULL DEFAULT true,
    "clientPaymentDaysWait" INTEGER NOT NULL DEFAULT 7,
    "clientInvoiceFound" BOOLEAN NOT NULL DEFAULT true,
    "clientUrgentOnly" BOOLEAN NOT NULL DEFAULT true,
    "maxMessagesPerDay" INTEGER NOT NULL DEFAULT 2,
    "quietHoursStart" TEXT NOT NULL DEFAULT '21:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
    "noMessagesOnSaturday" BOOLEAN NOT NULL DEFAULT true,
    "noMessagesOnHolidays" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "NotificationRules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAssistant_organizationId_key" ON "WhatsAppAssistant"("organizationId");
CREATE INDEX "WhatsAppNotification_organizationId_sentAt_idx" ON "WhatsAppNotification"("organizationId", "sentAt");
CREATE INDEX "WhatsAppNotification_phone_sentAt_idx" ON "WhatsAppNotification"("phone", "sentAt");
CREATE INDEX "WhatsAppNotification_phone_type_sentAt_idx" ON "WhatsAppNotification"("phone", "type", "sentAt");
CREATE UNIQUE INDEX "WhatsAppConversation_organizationId_phone_key" ON "WhatsAppConversation"("organizationId", "phone");
CREATE INDEX "WhatsAppConversation_organizationId_lastMessageAt_idx" ON "WhatsAppConversation"("organizationId", "lastMessageAt");
CREATE UNIQUE INDEX "NotificationRules_organizationId_key" ON "NotificationRules"("organizationId");

ALTER TABLE "WhatsAppAssistant" ADD CONSTRAINT "WhatsAppAssistant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppNotification" ADD CONSTRAINT "WhatsAppNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRules" ADD CONSTRAINT "NotificationRules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
