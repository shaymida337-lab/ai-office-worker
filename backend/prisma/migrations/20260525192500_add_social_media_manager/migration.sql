CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "pageId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "canvaDesignId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "approvalToken" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "analytics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialSettings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "brandColors" TEXT,
    "brandVoice" TEXT,
    "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "targetAudience" TEXT,
    "canvaTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialAccount_clientId_platform_key" ON "SocialAccount"("clientId", "platform");
CREATE INDEX "SocialAccount_clientId_isActive_idx" ON "SocialAccount"("clientId", "isActive");
CREATE INDEX "SocialPost_clientId_scheduledAt_idx" ON "SocialPost"("clientId", "scheduledAt");
CREATE INDEX "SocialPost_status_scheduledAt_idx" ON "SocialPost"("status", "scheduledAt");
CREATE INDEX "SocialPost_approvalToken_idx" ON "SocialPost"("approvalToken");
CREATE UNIQUE INDEX "SocialSettings_clientId_key" ON "SocialSettings"("clientId");

ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialSettings" ADD CONSTRAINT "SocialSettings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
