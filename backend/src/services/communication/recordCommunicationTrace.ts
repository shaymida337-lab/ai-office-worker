import { randomUUID } from "crypto";
import { CommunicationService, communicationService } from "./communicationService.js";
import type { CommunicationEnvelope } from "./types.js";

type TraceDeps = {
  service?: CommunicationService;
};

export async function recordCommunicationTrace(
  envelope: CommunicationEnvelope,
  options: { stage?: string } & TraceDeps = {}
): Promise<void> {
  const service = options.service ?? communicationService;
  try {
    await service.createCommunicationEvent(envelope, { stage: options.stage });
  } catch (err) {
    console.warn(
      "[communication] trace recording failed",
      {
        organizationId: envelope.organizationId,
        channel: envelope.channel,
        externalMessageId: envelope.externalMessageId,
        correlationId: envelope.correlationId,
        stage: options.stage ?? "created",
      },
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function recordCommunicationTraceFireAndForget(
  envelope: CommunicationEnvelope,
  options: { stage?: string } & TraceDeps = {}
): void {
  void recordCommunicationTrace(envelope, options);
}

export async function recordInboundWhatsAppCommunication(
  input: {
    organizationId: string;
    providerMessageSid: string;
    fromNumber?: string;
    toNumber?: string;
    body: string;
    whatsappLogId: string;
    media?: Array<{ filename?: string | null; contentType?: string; url?: string }>;
    correlationId?: string;
  },
  deps: TraceDeps = {}
): Promise<void> {
  const correlationId = input.correlationId ?? input.providerMessageSid;
  await recordCommunicationTrace(
    {
      organizationId: input.organizationId,
      channel: "whatsapp",
      direction: "inbound",
      externalMessageId: input.providerMessageSid,
      correlationId,
      sender: input.fromNumber ?? null,
      recipient: input.toNumber ?? null,
      body: input.body,
      sourceReference: input.whatsappLogId,
      attachments: input.media?.map((item) => ({
        url: item.url,
        filename: item.filename,
        contentType: item.contentType,
      })),
      metadata: { whatsappLogId: input.whatsappLogId },
      occurredAt: new Date(),
    },
    { stage: "inbound_received", service: deps.service }
  );
}

export async function recordGmailCommunication(
  input: {
    organizationId: string;
    gmailMessageId: string;
    emailMessageId: string;
    from: string;
    subject?: string;
    bodyText: string;
    occurredAt: Date;
    correlationId?: string;
  },
  deps: TraceDeps = {}
): Promise<void> {
  const correlationId = input.correlationId ?? input.gmailMessageId;
  await recordCommunicationTrace(
    {
      organizationId: input.organizationId,
      channel: "gmail",
      direction: "inbound",
      externalMessageId: input.gmailMessageId,
      correlationId,
      sender: input.from,
      body: input.bodyText,
      subject: input.subject ?? null,
      sourceReference: input.emailMessageId,
      metadata: { emailMessageId: input.emailMessageId, gmailMessageId: input.gmailMessageId },
      occurredAt: input.occurredAt,
    },
    { stage: "gmail_scanned", service: deps.service }
  );
}

export async function recordWebChatCommunication(
  input: {
    organizationId: string;
    userId: string;
    message: string;
    sessionId?: string | null;
    correlationId?: string;
  },
  deps: TraceDeps = {}
): Promise<void> {
  const externalMessageId = randomUUID();
  const correlationId = input.correlationId ?? input.sessionId ?? externalMessageId;
  await recordCommunicationTrace(
    {
      organizationId: input.organizationId,
      channel: "web_chat",
      direction: "inbound",
      externalMessageId,
      correlationId,
      sender: input.userId,
      body: input.message,
      metadata: { sessionId: input.sessionId ?? null, userId: input.userId },
      occurredAt: new Date(),
    },
    { stage: "web_chat_received", service: deps.service }
  );
}

export async function recordVoiceCommunication(
  input: {
    organizationId: string;
    userId: string;
    turnId: string;
    transcript: string;
    sessionId?: string | null;
    correlationId?: string;
  },
  deps: TraceDeps = {}
): Promise<void> {
  const correlationId = input.correlationId ?? input.turnId;
  await recordCommunicationTrace(
    {
      organizationId: input.organizationId,
      channel: "web_voice",
      direction: "inbound",
      externalMessageId: input.turnId,
      correlationId,
      sender: input.userId,
      body: input.transcript,
      metadata: { sessionId: input.sessionId ?? null, userId: input.userId, turnId: input.turnId },
      occurredAt: new Date(),
    },
    { stage: "voice_turn_started", service: deps.service }
  );
}
