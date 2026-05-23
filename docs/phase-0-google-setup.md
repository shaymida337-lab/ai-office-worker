# Phase 0 — Google & Make.com setup (beginner guide)

**Time:** about 45–60 minutes  
**Region:** Israel · Hebrew · ILS  

Complete every checkbox before starting Phase 1 in Make.com.

---

## Checklist

- [ ] 1. Google Cloud project + APIs
- [ ] 2. Google Drive folders (Apps Script)
- [ ] 3. Google Sheet from CSV templates
- [ ] 4. Gmail labels
- [ ] 5. WhatsApp → Gmail forwarding habit
- [ ] 6. Make.com connections
- [ ] 7. Config sheet filled
- [ ] 8. Save IDs in safe place

---

## 1. Google Cloud project (for Make.com OAuth)

> Personal Gmail works with Make.com’s built-in Google connectors.  
> This step prepares you for **Workspace later** and stricter API control.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. **Select project** → **New Project** → name: `ai-office-worker`.
3. **APIs & Services → Library** — enable:
   - Gmail API
   - Google Drive API
   - Google Sheets API
4. **APIs & Services → OAuth consent screen**
   - User type: **External** (personal Gmail) or **Internal** (Workspace later)
   - App name: `AI Office Worker`
   - Add your email as **Test user** while in Testing mode
5. **Credentials** — you usually **do not** need manual credentials for Make.com; Make uses its own OAuth. Keep this project for future custom scripts.

---

## 2. Create Drive folders

Follow [../google-apps-script/README.md](../google-apps-script/README.md).

Verify in Drive:

```
AI-Office-Worker/
├── Invoices/
├── Payment-Requests/
├── Receipts/
├── Other/
├── WhatsApp-Uploads/Inbox/
├── Reports/Missing-Invoices/
├── Reports/Daily-Summaries/
└── Manual-Review/
```

---

## 3. Create Google Sheet

Follow [../templates/sheets/README.md](../templates/sheets/README.md).

1. Spreadsheet name: **Supplier Payments**
2. Five tabs: Supplier Payments, Tasks, Daily Log, Config, Missing Invoices Report
3. Update **Config** tab with your real Gmail address
4. Save **Spreadsheet ID** from URL:

```
https://docs.google.com/spreadsheets/d/COPY_THIS_PART/edit
```

---

## 4. Gmail labels

In Gmail (web):

1. **Settings (gear) → See all settings → Labels → Create new label**
2. Create parent label: `AI-Office-Worker`
3. Nested labels:
   - `AI-Office-Worker/Processed`
   - `AI-Office-Worker/Manual-Review`
4. Create: `WhatsApp-Forwarded`

Optional filter for WhatsApp forwards:

- **Settings → Filters → Create new filter**
- Criteria (adjust): `subject:(WhatsApp forwarded OR הועבר מוואטסאפ) OR from:(your-mobile-carrier-forward@gateway)`  
  *Tip: After you forward once from the phone, check the real “From” address and refine the filter.*
- Action: Apply label `WhatsApp-Forwarded`

---

## 5. WhatsApp → Gmail (MVP)

Read [gmail-whatsapp-forwarding.md](./gmail-whatsapp-forwarding.md) and practice with one test PDF.

---

## 6. Make.com connections

1. Sign up at [Make.com](https://www.make.com).
2. **Connections → Add**:
   - **Google Gmail** — sign in with the same personal Gmail
   - **Google Drive** — same account
   - **Google Sheets** — same account
   - **OpenAI** — paste API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
3. Create a test scenario: Gmail → list 1 message → run once. Confirm success.

**OpenAI billing:** add payment method under **Settings → Billing** (API usage is pay-as-you-go).

---

## 7. Fill Config sheet

Open tab **Config** and set at minimum:

| Key | Your value |
|-----|------------|
| gmail_account | your@gmail.com |
| summary_recipient | your@gmail.com |
| timezone | Asia/Jerusalem |
| currency | ILS |

---

## 8. Save these for Phase 1

Store in a password manager or `.env` (local only, never commit):

| Item | Where to find |
|------|----------------|
| Spreadsheet ID | Sheets URL |
| Drive root folder name | `AI-Office-Worker` |
| OpenAI API key | OpenAI dashboard |
| Make.com organization | Your login |

---

## Phase 0 complete?

When all checkboxes are done, open [../make/scenarios-checklist.md](../make/scenarios-checklist.md) and start **Scenario 01 — Daily Gmail Scan**.
