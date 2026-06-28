/** Gmail search window for recurring fast scans (scheduler + manual fast phase). */
export const FAST_SCAN_DATE_FILTER = "newer_than:1d";

const FAST_SCAN_FINANCE_KEYWORDS =
  '{invoice receipt payment "payment request" חשבונית קבלה תשלום "דרישת תשלום"}';

const FAST_SCAN_IMAGE_ATTACHMENTS =
  "{filename:jpg filename:jpeg filename:png filename:webp filename:heic filename:pdf}";

const FAST_SCAN_SUBJECT_TERMS = ["חשבונית", "invoice", "receipt", "קבלה", '"דרישת תשלום"'];

/**
 * Fast scan uses lighter exclusions than the full historical scan.
 * Invoice attachments often land in Promotions/Social — excluding those tabs
 * caused zero-result fast scans for otherwise valid invoice emails.
 */
export function buildFastScanExcludeQuery(_options: { scanAllMail?: boolean } = {}): string {
  return "-in:spam -in:trash";
}

export function buildFastScanQueries(options: { scanAllMail?: boolean } = {}): string[] {
  const dateFilter = FAST_SCAN_DATE_FILTER;
  const excludeQuery = buildFastScanExcludeQuery(options);

  const queries = [
    `${dateFilter} has:attachment ${excludeQuery}`,
    `${dateFilter} has:attachment ${FAST_SCAN_FINANCE_KEYWORDS} ${excludeQuery}`,
    `${dateFilter} in:sent has:attachment ${excludeQuery}`,
    `${dateFilter} has:attachment ${FAST_SCAN_IMAGE_ATTACHMENTS} ${excludeQuery}`,
  ];

  for (const term of FAST_SCAN_SUBJECT_TERMS) {
    queries.push(`${dateFilter} subject:${term} has:attachment ${excludeQuery}`);
    queries.push(`${dateFilter} subject:${term} ${excludeQuery}`);
  }

  return queries;
}
