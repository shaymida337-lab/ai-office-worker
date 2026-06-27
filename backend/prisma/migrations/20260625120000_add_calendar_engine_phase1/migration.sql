-- Natalie Calendar Engine Phase 1 — schema only, no data migration

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('draft', 'pending_readiness', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('manual', 'ai_chat', 'voice', 'whatsapp', 'email', 'booking_page', 'migration', 'system');

-- CreateEnum
CREATE TYPE "DecisionQueueType" AS ENUM ('confirm_appointment', 'reschedule_appointment', 'cancel_appointment', 'create_invoice_placeholder', 'send_follow_up_message', 'override_conflict');

-- CreateEnum
CREATE TYPE "DecisionQueueStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "TimelineEntryType" AS ENUM ('work_case_created', 'event_created', 'prerequisite_passed', 'prerequisite_failed', 'approval_requested', 'approval_granted', 'approval_rejected', 'status_changed', 'event_completed', 'event_no_show', 'event_cancelled', 'event_rescheduled', 'task_spawned', 'invoice_requested', 'google_sync_success', 'google_sync_failed', 'note_added', 'natalie_command');

-- CreateEnum
CREATE TYPE "WorkCaseStatus" AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CompletionOutcome" AS ENUM ('completed_success', 'completed_early', 'no_show', 'cancelled_by_customer', 'cancelled_by_business');

-- CreateEnum
CREATE TYPE "GoogleSyncStatus" AS ENUM ('skipped', 'pending', 'synced', 'failed', 'deleted');

-- CreateEnum
CREATE TYPE "DecisionItemSource" AS ENUM ('manual', 'natalie_command', 'system');

-- CreateEnum
CREATE TYPE "TimelineActorType" AS ENUM ('user', 'system', 'natalie');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "calendar_autonomy_json" JSONB NOT NULL DEFAULT '{"calendarAutonomy":{"autoConfirmWhenFullyReady":false,"autoSendFollowUp":false,"autoSyncGoogleOnConfirm":true,"autoCreateFollowUpTask":true}}';

-- CreateTable
CREATE TABLE "WorkCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "WorkCaseStatus" NOT NULL DEFAULT 'open',
    "clientId" TEXT,
    "leadId" TEXT,
    "assignedUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'calendar',
    "description" TEXT,
    "priority" TEXT,
    "invoiceDraftRequested" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'appointment',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "workCaseId" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "assignedUserId" TEXT,
    "serviceId" TEXT,
    "locationType" TEXT DEFAULT 'office',
    "address" TEXT,
    "remoteLink" TEXT,
    "prerequisitesJson" JSONB NOT NULL DEFAULT '[]',
    "completionNotes" TEXT,
    "completionOutcome" "CompletionOutcome",
    "rescheduledFromId" TEXT,
    "googleEventId" TEXT,
    "googleSyncStatus" "GoogleSyncStatus" NOT NULL DEFAULT 'skipped',
    "lastSyncedAt" TIMESTAMP(3),
    "source" "EventSource" NOT NULL,
    "internalNotes" TEXT,
    "legacyAppointmentId" TEXT,
    "createdByUserId" TEXT,
    "commandSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventAudit" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" "TimelineActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "CalendarEventStatus",
    "toStatus" "CalendarEventStatus",
    "changesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCaseTimelineEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workCaseId" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "type" "TimelineEntryType" NOT NULL,
    "summary" TEXT NOT NULL,
    "actorType" "TimelineActorType" NOT NULL,
    "actorUserId" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCaseTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerDecisionQueueItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workCaseId" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "type" "DecisionQueueType" NOT NULL,
    "status" "DecisionQueueStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "preparedPayloadJson" JSONB,
    "source" "DecisionItemSource" NOT NULL,
    "executionIdempotencyKey" TEXT,
    "metaJson" JSONB,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerDecisionQueueItem_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "workCaseId" TEXT,
ADD COLUMN "calendarEventId" TEXT;

-- CreateIndex
CREATE INDEX "WorkCase_organizationId_status_idx" ON "WorkCase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkCase_clientId_idx" ON "WorkCase"("clientId");

-- CreateIndex
CREATE INDEX "WorkCase_assignedUserId_idx" ON "WorkCase"("assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_rescheduledFromId_key" ON "CalendarEvent"("rescheduledFromId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_legacyAppointmentId_key" ON "CalendarEvent"("legacyAppointmentId");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_startAt_idx" ON "CalendarEvent"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_status_idx" ON "CalendarEvent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CalendarEvent_workCaseId_idx" ON "CalendarEvent"("workCaseId");

-- CreateIndex
CREATE INDEX "CalendarEvent_assignedUserId_startAt_idx" ON "CalendarEvent"("assignedUserId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_clientId_idx" ON "CalendarEvent"("clientId");

-- CreateIndex
CREATE INDEX "CalendarEventAudit_calendarEventId_createdAt_idx" ON "CalendarEventAudit"("calendarEventId", "createdAt");

-- CreateIndex
CREATE INDEX "CalendarEventAudit_organizationId_createdAt_idx" ON "CalendarEventAudit"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkCaseTimelineEntry_workCaseId_createdAt_idx" ON "WorkCaseTimelineEntry"("workCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkCaseTimelineEntry_organizationId_createdAt_idx" ON "WorkCaseTimelineEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OwnerDecisionQueueItem_organizationId_status_createdAt_idx" ON "OwnerDecisionQueueItem"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OwnerDecisionQueueItem_calendarEventId_status_idx" ON "OwnerDecisionQueueItem"("calendarEventId", "status");

-- CreateIndex
CREATE INDEX "OwnerDecisionQueueItem_workCaseId_status_idx" ON "OwnerDecisionQueueItem"("workCaseId", "status");

-- CreateIndex
CREATE INDEX "Task_workCaseId_status_idx" ON "Task"("workCaseId", "status");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workCaseId_fkey" FOREIGN KEY ("workCaseId") REFERENCES "WorkCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCase" ADD CONSTRAINT "WorkCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCase" ADD CONSTRAINT "WorkCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCase" ADD CONSTRAINT "WorkCase_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCase" ADD CONSTRAINT "WorkCase_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_workCaseId_fkey" FOREIGN KEY ("workCaseId") REFERENCES "WorkCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAudit" ADD CONSTRAINT "CalendarEventAudit_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventAudit" ADD CONSTRAINT "CalendarEventAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCaseTimelineEntry" ADD CONSTRAINT "WorkCaseTimelineEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCaseTimelineEntry" ADD CONSTRAINT "WorkCaseTimelineEntry_workCaseId_fkey" FOREIGN KEY ("workCaseId") REFERENCES "WorkCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCaseTimelineEntry" ADD CONSTRAINT "WorkCaseTimelineEntry_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerDecisionQueueItem" ADD CONSTRAINT "OwnerDecisionQueueItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerDecisionQueueItem" ADD CONSTRAINT "OwnerDecisionQueueItem_workCaseId_fkey" FOREIGN KEY ("workCaseId") REFERENCES "WorkCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerDecisionQueueItem" ADD CONSTRAINT "OwnerDecisionQueueItem_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
