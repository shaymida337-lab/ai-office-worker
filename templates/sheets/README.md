# Google Sheets templates

Import these CSV files into **one** Google Spreadsheet named **Supplier Payments**.

## Import steps (beginner)

1. Open [Google Sheets](https://sheets.google.com) → **Blank spreadsheet**.
2. Rename the file to **Supplier Payments**.
3. For each CSV below:
   - **File → Import → Upload** → select the CSV.
   - Import location: **Replace current sheet** (first file) or **Insert new sheet(s)** (rest).
   - Separator: **Comma**.
4. Rename tabs exactly:

| Tab name | CSV file |
|----------|----------|
| Supplier Payments | `supplier-payments.csv` |
| Tasks | `tasks.csv` |
| Daily Log | `daily-log.csv` |
| Config | `config.csv` |
| Missing Invoices Report | `missing-invoices-report.csv` |

5. Delete the two **sample rows** in Supplier Payments and Tasks after import.
6. Fill all `YOUR_GMAIL@gmail.com` values in the **Config** tab.
7. Copy the **Spreadsheet ID** from the URL for Make.com:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

## Column notes

- Headers are in **English** so Make.com mappings stay stable.
- Sample data uses **Hebrew** supplier names to match Israel use case.
- **Source** values: `Gmail`, `WhatsApp-Forward`, `Manual`.
- **Missing invoice** can be automated in Make or formula in column I:

```excel
=IF(AND(E2="Yes"; G2<>""; H2=""); "Yes"; "No")
```

## Hebrew reference

| English header | עברית |
|----------------|--------|
| Date | תאריך |
| Supplier Name | שם ספק |
| Subject | נושא |
| Amount | סכום (₪) |
| Payment Required | נדרש תשלום |
| Paid | שולם |
| Link to payment request file | קישור לדרישת תשלום |
| Link to invoice receipt | קישור לחשבונית / קבלה |
| Missing invoice | חשבונית חסרה |
