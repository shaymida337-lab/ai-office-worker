# Google Drive folder structure

This folder is a **local reference mirror** of the tree created in your Google Drive.

**To create folders in Google Drive automatically:** run the script in  
[../google-apps-script/create-drive-folders.gs](../google-apps-script/create-drive-folders.gs)

## Tree

```
AI-Office-Worker/                          ← root (drive_root_folder)
├── Invoices/
│   └── {Supplier Name}/                 ← created per supplier by Make.com
├── Payment-Requests/
│   └── {Supplier Name}/
├── Receipts/
│   └── {Supplier Name}/
├── Other/
│   └── {Supplier Name}/
├── WhatsApp-Uploads/
│   └── Inbox/                             ← optional manual uploads
├── Reports/
│   ├── Missing-Invoices/
│   └── Daily-Summaries/
└── Manual-Review/                         ← low-confidence AI results
```

## Naming rules (Make.com Phase 3)

- Pattern: `YYYY-MM-DD_{Supplier}_{document_type}_{original_filename}`
- Example: `2026-05-22_דוגמה-בעמ_invoice_חשבונית-123.pdf`
