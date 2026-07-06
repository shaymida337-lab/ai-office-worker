export function logCommunicationStage(input: {
  correlationId: string;
  organizationId: string;
  channel: string;
  externalMessageId: string;
  stage: string;
  eventId?: string;
}) {
  console.log("[communication]", {
    correlationId: input.correlationId,
    organizationId: input.organizationId,
    channel: input.channel,
    externalMessageId: input.externalMessageId,
    stage: input.stage,
    eventId: input.eventId,
  });
}
