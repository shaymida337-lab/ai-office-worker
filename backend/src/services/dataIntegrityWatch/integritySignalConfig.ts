/** Phase 2.3B/2.3D — tunable signal-quality parameters (read-only validation). */

export const DEFAULT_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export type IntegritySignalConfig = {
  orphanGracePeriodMs: number;
  testSenderPatterns: RegExp[];
  testSubjectPatterns: RegExp[];
  systemMailPatterns: RegExp[];
  junkSubjectPatterns: RegExp[];
  invoiceSubjectPatterns: RegExp[];
  financialAttachmentMimePatterns: RegExp[];
  financialAttachmentFilenamePatterns: RegExp[];
  unsupportedAttachmentMimePatterns: RegExp[];
  unsupportedAttachmentFilenamePatterns: RegExp[];
};

export const DEFAULT_INTEGRITY_SIGNAL_CONFIG: IntegritySignalConfig = {
  orphanGracePeriodMs: DEFAULT_ORPHAN_GRACE_PERIOD_MS,
  testSenderPatterns: [
    /shaymida337@gmail\.com/i,
    /shaykedma@gmail\.com/i,
    /shay\s*mida/i,
    /test@/i,
    /\+test/i,
    /qa\+/i,
    /internal\.qa@/i,
  ],
  testSubjectPatterns: [/לבדיקה/i, /בדיקה/i, /טסט/i, /\btest\b/i],
  systemMailPatterns: [
    /no-?reply@/i,
    /noreply@/i,
    /@google\.com/i,
    /@accounts\.google/i,
    /@render\.com/i,
    /@mail\.zapier\.com/i,
    /service@lottosheli/i,
    /alerts@/i,
  ],
  junkSubjectPatterns: [
    /privacy policy/i,
    /terms of service/i,
    /security alert/i,
    /unsubscribe/i,
    /newsletter/i,
    /פרסומת/i,
    /task limit/i,
  ],
  invoiceSubjectPatterns: [/חשבונית/i, /invoice/i, /tax\s*invoice/i, /קבלה/i],
  financialAttachmentMimePatterns: [
    /^application\/pdf$/i,
    /^image\//i,
  ],
  financialAttachmentFilenamePatterns: [/\.pdf$/i, /\.jpe?g$/i, /\.png$/i, /\.webp$/i, /\.heic$/i],
  unsupportedAttachmentMimePatterns: [/^text\/html$/i, /^text\/plain$/i],
  unsupportedAttachmentFilenamePatterns: [/\.html?$/i, /\.txt$/i],
};
