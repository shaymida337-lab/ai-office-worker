-- Partial unique index: inbound WhatsApp logs per org + provider SID.
-- Verified zero duplicate groups before deploy (Phase F).
CREATE UNIQUE INDEX "WhatsAppLog_org_inbound_providerMessageSid_key"
ON "WhatsAppLog" ("organizationId", "providerMessageSid")
WHERE direction = 'inbound'
  AND "providerMessageSid" IS NOT NULL
  AND "providerMessageSid" <> ''
  AND "providerMessageSid" <> 'unknown';
