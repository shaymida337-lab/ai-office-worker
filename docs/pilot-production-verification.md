# Pilot Production Verification

Use this checklist to verify the core pilot flow in production: Gmail -> OCR/parser -> database -> Drive -> Sheets -> UI.

## Preconditions

- Production Gmail integration is connected for the pilot organization.
- Google Drive and Google Sheets integrations are connected and have the expected permissions.
- Render logs are open and filtered for the pilot organization where possible.
- A pilot tester can access `/dashboard/invoices` and the relevant review/status filters.

## Core Flow Checks

1. Send a Gmail message with a PDF invoice attachment to the connected mailbox.
2. Send a second Gmail message with a photographed invoice image attachment, including HEIC/HEIF if available from an iPhone.
3. Observe Render logs for scheduler or fast-scan activity, OCR/image parsing, parser decisions, DB persistence, Drive upload, Sheets append, and these markers:
   - `DRIVE_FILE_SAVED`
   - `SHEETS_ROW_CREATED`
   - `PILOT_FLOW_SUCCESS`
4. Verify database persistence for the processed messages:
   - `GmailScanItem` exists with message metadata, decision status, amount/supplier where available, and Drive link when uploaded.
   - `FinancialDocumentReview` exists for the candidate with the expected accepted or review decision.
   - `SupplierPayment` and/or `Invoice` exists when the candidate is eligible for financial persistence.
5. Verify the Drive file exists, is stored in the expected supplier/client folder path, and the logged file link opens for the pilot account.
6. Verify the Google Sheets supplier payment row exists when a supplier payment or invoice row is expected. Confirm key fields such as supplier, amount, invoice number/date, status, Drive file link, and row timestamp.
7. Verify `/dashboard/invoices` shows the item in the expected invoice/review/status view. Check both auto-saved and needs-review outcomes when applicable.
8. Resend the same Gmail message or attachment. Confirm Render logs include `DUPLICATE_SKIPPED` with a safe reason/key and no duplicate `GmailScanItem`, `SupplierPayment`, `Invoice`, Drive file, or Sheets row is created.

## Rollback And Escalation

- If Gmail parsing fails, capture the message ID, sender, attachment filename, and relevant parser/OCR log lines.
- If DB persistence fails, stop duplicate resend testing and escalate with the `syncLog` ID and the failed marker or stack trace.
- If Drive or Sheets fails while DB persistence succeeds, note `PILOT_FLOW_SUCCESS` flags for `drive=false` or `sheets=false`, verify the DB record, and retry after confirming Google integration permissions.
- If duplicate protection fails, stop the pilot for that sender and escalate with the duplicate key, message ID, and created record IDs.
- If UI visibility fails but DB records exist, capture the record IDs and active UI filters before escalating.
