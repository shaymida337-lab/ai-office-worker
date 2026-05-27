CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "stage" TEXT NOT NULL DEFAULT 'חדש',
    "estimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assignedTo" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "priorityStars" INTEGER NOT NULL DEFAULT 1,
    "repliedAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "lastMessageStatus" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadTimeline" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadTimeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadSequence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "messageTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_organizationId_stage_createdAt_idx" ON "Lead"("organizationId", "stage", "createdAt");
CREATE INDEX "Lead_organizationId_source_idx" ON "Lead"("organizationId", "source");
CREATE INDEX "Lead_organizationId_assignedTo_idx" ON "Lead"("organizationId", "assignedTo");
CREATE INDEX "Lead_organizationId_nextReminderAt_idx" ON "Lead"("organizationId", "nextReminderAt");
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");
CREATE INDEX "Lead_email_idx" ON "Lead"("email");
CREATE INDEX "LeadTimeline_leadId_createdAt_idx" ON "LeadTimeline"("leadId", "createdAt");
CREATE INDEX "LeadSequence_leadId_status_idx" ON "LeadSequence"("leadId", "status");
CREATE INDEX "LeadSequence_status_scheduledAt_idx" ON "LeadSequence"("status", "scheduledAt");
CREATE UNIQUE INDEX "MessageTemplate_organizationId_name_channel_key" ON "MessageTemplate"("organizationId", "name", "channel");
CREATE INDEX "MessageTemplate_organizationId_channel_idx" ON "MessageTemplate"("organizationId", "channel");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadTimeline" ADD CONSTRAINT "LeadTimeline_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSequence" ADD CONSTRAINT "LeadSequence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
