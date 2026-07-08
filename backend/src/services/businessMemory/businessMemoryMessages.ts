/**
 * Hebrew response templates for Natalie Business Memory lookups.
 *
 * One message layer for chat, voice, WhatsApp, and future mobile.
 */

import {
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_CATEGORY_LABELS_PLURAL,
  type BusinessMemoryDocument,
  type BusinessMemoryDocumentType,
} from "./businessMemoryTypes.js";

export const businessMemoryMessages = {
  foundOne(doc: BusinessMemoryDocument): string {
    const lines = [`מצאתי את ${doc.title}.`];
    if (doc.driveUrl || doc.storageLocation) lines.push("הנה המסמך.");
    if (doc.driveUrl) lines.push(doc.driveUrl);
    else if (doc.storageLocation) lines.push(doc.storageLocation);
    return lines.join("\n");
  },

  foundMany(docs: BusinessMemoryDocument[]): string {
    const header =
      docs.length === 2
        ? "מצאתי שני מסמכים:"
        : docs.length === 3
          ? "מצאתי שלושה מסמכים:"
          : `מצאתי ${docs.length} מסמכים:`;
    const lines = docs.map((doc) => businessMemoryMessages.listEntry(doc));
    return `${header}\n${lines.join("\n")}\nאיזה מהם לפתוח?`;
  },

  list(docs: BusinessMemoryDocument[]): string {
    const header = docs.length === 1 ? "מצאתי מסמך אחד:" : `מצאתי ${docs.length} מסמכים:`;
    const lines = docs.map((doc) => businessMemoryMessages.listEntry(doc));
    return `${header}\n${lines.join("\n")}`;
  },

  listEntry(doc: BusinessMemoryDocument): string {
    const label = KNOWLEDGE_CATEGORY_LABELS[doc.documentType];
    const who = doc.customer ?? doc.supplier;
    return who ? `• ${label} (${who})` : `• ${label}`;
  },

  count(count: number, documentType: BusinessMemoryDocumentType): string {
    const plural = KNOWLEDGE_CATEGORY_LABELS_PLURAL[documentType];
    const singular = KNOWLEDGE_CATEGORY_LABELS[documentType];
    if (count === 0) return `אין לך ${plural} שמורים.`;
    if (count === 1) return `נמצא ${singular} אחד.`;
    return `יש לך ${count} ${plural}.`;
  },

  notFound(subject: string | null): string {
    return subject ? `לא מצאתי מסמך עבור ${subject}.` : "לא מצאתי מסמך שמתאים לבקשה.";
  },

  processingError(): string {
    return "סליחה, לא הצלחתי לגשת לזיכרון העסקי כרגע. אפשר לנסות שוב?";
  },
} as const;
