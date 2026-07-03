-- CreateTable
CREATE TABLE "NatalieConversationSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentChannel" TEXT NOT NULL DEFAULT 'web_chat',
    "structuredHistory" JSONB NOT NULL DEFAULT '[]',
    "pendingAction" JSONB,
    "pendingConfirmation" JSONB,
    "interruptionState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NatalieConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NatalieConversationSession_organizationId_userId_lastMessageAt_idx" ON "NatalieConversationSession"("organizationId", "userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "NatalieConversationSession_organizationId_lastMessageAt_idx" ON "NatalieConversationSession"("organizationId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "NatalieConversationSession" ADD CONSTRAINT "NatalieConversationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NatalieConversationSession" ADD CONSTRAINT "NatalieConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
