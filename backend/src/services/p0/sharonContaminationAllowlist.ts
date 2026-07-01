/** User-confirmed legitimate שרון business documents (2026-07-01). */
export const SHARON_CONFIRMED_ALLOWLIST = {
  confirmedAt: "2026-07-01T12:00:00.000Z",
  confirmedBy: "user",
  organizationId: "cmqxujfuj034ndy2czu9tjoko",
  rationale:
    "Document legitimately received in שרון mailbox (laperlaclinic120@gmail.com); cross-org duplicate ID does not imply foreign data.",
  gmailMessageIds: [
    "19eac05f383d017b",
    "19f1c987ae04f50b",
    "19ed3a45ad6c0c41",
    "19ed4213bdd6e726",
    "19ebfbbfb5c8e626",
  ],
} as const;

export function isAllowlistedGmailMessageId(gmailMessageId: string | null | undefined): boolean {
  if (!gmailMessageId) return false;
  return (SHARON_CONFIRMED_ALLOWLIST.gmailMessageIds as readonly string[]).includes(gmailMessageId);
}
