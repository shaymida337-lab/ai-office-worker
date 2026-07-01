/** Phase 2.3B — tunable signal-quality parameters (read-only validation). */

export const DEFAULT_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export type IntegritySignalConfig = {
  orphanGracePeriodMs: number;
  testSenderPatterns: RegExp[];
  systemMailPatterns: RegExp[];
  junkSubjectPatterns: RegExp[];
  invoiceSubjectPatterns: RegExp[];
};

export const DEFAULT_INTEGRITY_SIGNAL_CONFIG: IntegritySignalConfig = {
  orphanGracePeriodMs: DEFAULT_ORPHAN_GRACE_PERIOD_MS,
  testSenderPatterns: [
    /shaymida337@gmail\.com/i,
    /shay\s*mida/i,
    /test@/i,
    /\+test/i,
  ],
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
};
