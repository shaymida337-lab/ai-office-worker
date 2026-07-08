/**
 * Centralized Hebrew response templates for Knowledge Center lookups.
 *
 * Same philosophy as calendarMessages: short, human, non-technical Hebrew, no
 * LLM prose for supported commands. One place so wording stays consistent
 * across chat, voice, and WhatsApp.
 */

import {
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_CATEGORY_LABELS_PLURAL,
  type KnowledgeCategory,
  type KnowledgeDocumentSummary,
} from "./knowledgeTypes.js";

export const knowledgeMessages = {
  /** Single document found — echo what was found and where to open it. */
  foundOne(doc: KnowledgeDocumentSummary): string {
    const lines = [`מצאתי את ${doc.title}.`];
    if (doc.driveUrl || doc.storageLocation) lines.push("הנה המסמך.");
    if (doc.driveUrl) lines.push(doc.driveUrl);
    else if (doc.storageLocation) lines.push(doc.storageLocation);
    return lines.join("\n");
  },

  /** Multiple documents found — list them and ask which to open. */
  foundMany(docs: KnowledgeDocumentSummary[]): string {
    const header =
      docs.length === 2
        ? "מצאתי שני מסמכים:"
        : docs.length === 3
          ? "מצאתי שלושה מסמכים:"
          : `מצאתי ${docs.length} מסמכים:`;
    const lines = docs.map((doc) => knowledgeMessages.listEntry(doc));
    return `${header}\n${lines.join("\n")}\nאיזה מהם לפתוח?`;
  },

  /** List result (no "which to open" prompt). */
  list(docs: KnowledgeDocumentSummary[]): string {
    const header = docs.length === 1 ? "מצאתי מסמך אחד:" : `מצאתי ${docs.length} מסמכים:`;
    const lines = docs.map((doc) => knowledgeMessages.listEntry(doc));
    return `${header}\n${lines.join("\n")}`;
  },

  listEntry(doc: KnowledgeDocumentSummary): string {
    const label = KNOWLEDGE_CATEGORY_LABELS[doc.category];
    const who = doc.customerName ?? doc.supplierName;
    return who ? `• ${label} (${who})` : `• ${label}`;
  },

  count(count: number, category: KnowledgeCategory): string {
    const plural = KNOWLEDGE_CATEGORY_LABELS_PLURAL[category];
    const singular = KNOWLEDGE_CATEGORY_LABELS[category];
    if (count === 0) return `אין לך ${plural} שמורים.`;
    if (count === 1) return `נמצא ${singular} אחד.`;
    return `יש לך ${count} ${plural}.`;
  },

  notFound(subject: string | null): string {
    return subject ? `לא מצאתי מסמך עבור ${subject}.` : "לא מצאתי מסמך שמתאים לבקשה.";
  },

  processingError(): string {
    return "סליחה, לא הצלחתי לגשת למאגר המסמכים כרגע. אפשר לנסות שוב?";
  },
} as const;
