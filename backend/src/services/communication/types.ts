export const COMMUNICATION_CHANNELS = ["whatsapp", "gmail", "web_chat", "web_voice", "email", "api"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_DIRECTIONS = ["inbound", "outbound"] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export type CommunicationAttachment = {
  url?: string;
  filename?: string | null;
  contentType?: string;
  sizeBytes?: number;
};

export type CommunicationEnvelope = {
  organizationId: string;
  channel: CommunicationChannel | string;
  direction: CommunicationDirection | string;
  externalMessageId: string;
  correlationId: string;
  sender?: string | null;
  recipient?: string | null;
  subject?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  attachments?: CommunicationAttachment[] | null;
  sourceReference?: string | null;
  occurredAt?: Date | string | null;
};

export type CommunicationEventRecord = {
  id: string;
  organizationId: string;
  channel: string;
  direction: string;
  externalMessageId: string;
  correlationId: string;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  bodyPreview: string | null;
  metadataJson: unknown;
  sourceReference: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCommunicationEventResult = {
  event: CommunicationEventRecord;
  created: boolean;
};

export type CommunicationHistoryFilters = {
  organizationId: string;
  channel?: string;
  direction?: string;
  correlationId?: string;
  fromDate?: Date;
  toDate?: Date;
  offset?: number;
  limit?: number;
};

export type CommunicationHistoryResult = {
  items: CommunicationEventRecord[];
  total: number;
  offset: number;
  limit: number;
};
