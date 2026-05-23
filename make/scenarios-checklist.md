# Make.com scenarios checklist (Phase 1+)

Start only after [Phase 0](../docs/phase-0-google-setup.md) is complete.

| # | Scenario name | Trigger | Status |
|---|---------------|---------|--------|
| 01 | Daily Gmail Scan | Schedule 07:00 Asia/Jerusalem | ⬜ |
| 02 | AI Classify Email | Sub-scenario / after 01 | ⬜ |
| 03 | Organize Attachments | After 02 | ⬜ |
| 04 | Upsert Supplier Payment Row | After 03 | ⬜ |
| 05 | Missing Invoices Report | Weekly Sun 08:00 | ⬜ |
| 06 | WhatsApp Forward Handler | Filter label WhatsApp-Forwarded | ⬜ |
| 07 | Daily Summary Email | Schedule 18:00 | ⬜ |
| 99 | Error Alert to Admin | On error in any scenario | ⬜ |

---

## Scenario 01 — modules (outline)

1. **Schedule** — Run once a day 07:00
2. **Gmail → Search Messages**

```
newer_than:1d (
  has:attachment OR
  subject:(חשבונית OR "חשבונית מס" OR דרישת OR תשלום OR invoice OR payment OR WhatsApp) OR
  (חשבונית OR תשלום)
)
-label:AI-Office-Worker/Processed
```

3. **Iterator** — bundle emails
4. **Gmail → Get an Email**
5. **Filter** — exclude noreply, newsletters
6. **Router** — has attachment OR payment keywords → call 02

---

## IDs to paste in modules

| Variable | Source |
|----------|--------|
| Spreadsheet ID | Config / Sheets URL |
| Sheet name | `Supplier Payments` |
| Drive folder | Search `AI-Office-Worker` parent |

---

## Error scenario 99

- **Error handler** on scenarios 01–07
- Send Gmail to `summary_recipient` with scenario name + error message
