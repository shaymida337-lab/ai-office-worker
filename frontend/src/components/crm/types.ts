export type Lead = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  source: string;
  stage: string;
  estimatedValue: number;
  assignedTo: string | null;
  tags: string[];
  notes: string | null;
  attachments: string[];
  score: number;
  priorityStars: number;
  repliedAt: string | null;
  lastContactAt: string | null;
  nextReminderAt: string | null;
  lastMessageStatus: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ id: string; type: string; content: string; channel: string | null; createdAt: string }>;
  sequences: Array<{ id: string; step: number; channel: string; template: string; scheduledAt: string; sentAt: string | null; status: string }>;
};

export type CrmQuickFilter = "all" | "leads" | "customers" | "pending" | "followup";

export type CrmProfileTab =
  | "details"
  | "timeline"
  | "appointments"
  | "documents"
  | "payments"
  | "notes"
  | "tasks"
  | "whatsapp";
