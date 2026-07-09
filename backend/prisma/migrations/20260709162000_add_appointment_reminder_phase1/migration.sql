CREATE TABLE "AppointmentReminderJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "touchpoint" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "locale" TEXT NOT NULL DEFAULT 'he',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scheduledForUtc" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "provider" TEXT,
  "providerMessageId" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3),
  "timeoutAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentReminderJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentReminderEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "reminderJobId" TEXT,
  "eventType" TEXT NOT NULL,
  "eventSource" TEXT NOT NULL,
  "actor" TEXT,
  "provider" TEXT,
  "providerMessageId" TEXT,
  "providerEventId" TEXT,
  "payloadJsonSanitized" JSONB,
  "occurredAtUtc" TIMESTAMP(3) NOT NULL,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentReminderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentAttendanceProjection" (
  "appointmentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "attendanceState" TEXT NOT NULL DEFAULT 'scheduled',
  "reminderState" TEXT NOT NULL DEFAULT 'reminder_pending',
  "confirmationStatus" TEXT NOT NULL DEFAULT 'unknown',
  "responseChannel" TEXT,
  "responseLocale" TEXT,
  "lastReminderSentAt" TIMESTAMP(3),
  "lastResponseAt" TIMESTAMP(3),
  "nextReminderAt" TIMESTAMP(3),
  "lastTransitionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastTransitionReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentAttendanceProjection_pkey" PRIMARY KEY ("appointmentId")
);

CREATE UNIQUE INDEX "AppointmentReminderJob_idempotencyKey_key" ON "AppointmentReminderJob"("idempotencyKey");
CREATE UNIQUE INDEX "AppointmentReminderEvent_dedupeKey_key" ON "AppointmentReminderEvent"("dedupeKey");

CREATE INDEX "AppointmentReminderJob_status_scheduledForUtc_idx" ON "AppointmentReminderJob"("status", "scheduledForUtc");
CREATE INDEX "AppointmentReminderJob_status_nextAttemptAt_idx" ON "AppointmentReminderJob"("status", "nextAttemptAt");
CREATE INDEX "AppointmentReminderJob_leaseExpiresAt_idx" ON "AppointmentReminderJob"("leaseExpiresAt");
CREATE INDEX "AppointmentReminderJob_organizationId_appointmentId_createdAt_idx" ON "AppointmentReminderJob"("organizationId", "appointmentId", "createdAt");

CREATE INDEX "AppointmentReminderEvent_organizationId_appointmentId_occurredAtUtc_idx" ON "AppointmentReminderEvent"("organizationId", "appointmentId", "occurredAtUtc");
CREATE INDEX "AppointmentReminderEvent_reminderJobId_occurredAtUtc_idx" ON "AppointmentReminderEvent"("reminderJobId", "occurredAtUtc");
CREATE INDEX "AppointmentReminderEvent_eventType_occurredAtUtc_idx" ON "AppointmentReminderEvent"("eventType", "occurredAtUtc");

CREATE INDEX "AppointmentAttendanceProjection_organizationId_attendanceState_idx" ON "AppointmentAttendanceProjection"("organizationId", "attendanceState");
CREATE INDEX "AppointmentAttendanceProjection_organizationId_reminderState_idx" ON "AppointmentAttendanceProjection"("organizationId", "reminderState");

ALTER TABLE "AppointmentReminderJob"
ADD CONSTRAINT "AppointmentReminderJob_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentReminderJob"
ADD CONSTRAINT "AppointmentReminderJob_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentReminderEvent"
ADD CONSTRAINT "AppointmentReminderEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentReminderEvent"
ADD CONSTRAINT "AppointmentReminderEvent_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentReminderEvent"
ADD CONSTRAINT "AppointmentReminderEvent_reminderJobId_fkey"
FOREIGN KEY ("reminderJobId") REFERENCES "AppointmentReminderJob"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AppointmentAttendanceProjection"
ADD CONSTRAINT "AppointmentAttendanceProjection_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentAttendanceProjection"
ADD CONSTRAINT "AppointmentAttendanceProjection_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
