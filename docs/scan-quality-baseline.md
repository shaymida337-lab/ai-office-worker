# Baseline איכות צינור הסריקה — שלב 1

> נוצר ע"י `backend/scripts/scan-quality-report.ts` על **DB מקומי** (localhost).
> ⚠️ ה-DB המקומי מכיל רק נתוני בדיקה (10 רשומות camera) — ה-baseline האמיתי של
> בעיות פרודקשן יימדד ע"י הרצת אותו סקריפט בפרודקשן אחרי deploy (שלב 7 / המלצות).

```
scan-quality-report | 2026-07-03T20:09:12.574Z | host=localhost
GmailScanItem=0 | FinancialDocumentReview=5 | SupplierPayment=5 | Invoice=0

=== 1. ספק חסר / זבל ===
table                     | total | missing | junk  | junk%
GmailScanItem             |     0 |       0 |     0 | -
FinancialDocumentReview   |     5 |       0 |     0 | 0.0%
SupplierPayment           |     5 |       0 |     0 | 0.0%
Invoice                   |     0 |       0 |     0 | -

=== 2. סכומים חשודים (0 / >=1M / null) ===
table                     | zero | >=1M | null
GmailScanItem             |    0 |    0 |    0
FinancialDocumentReview   |    0 |    0 |    0
SupplierPayment           |    0 |    0 |    0
Invoice                   |    0 |    0 |    0

=== 2b. amount=0 לפי מקור ===
(אין)

=== 3. תאריך מסמך חסר / עתידי (>=שנה) / normalizedDocumentDate ריק ===
table                     | date-null | future>=1y | normDate-null
GmailScanItem             |         0 |          0 |             0
FinancialDocumentReview   |         0 |          0 |             5
SupplierPayment           |         0 |          0 |             5
Invoice                   |         0 |          0 |             0

=== 3b. תאריכים בעייתיים לפי מקור (F4: גבול ±2 שנים חסר ב-whatsapp/camera) ===
table / source                           | missing | future>=1y | out-of-±2y
FinancialDocumentReview / camera         |       0 |          0 |          0
SupplierPayment / camera                 |       0 |          0 |          0

=== 4. כפילויות חשודות (אותו ארגון+ספק+סכום+תאריך) ===
זוגות FDR↔Payment מקושרים (by-design, הוחרגו): 5
קבוצות כפולות בתוך אותה טבלה : 0 (עודף רשומות: 0)
קבוצות כפולות בין טבלאות     : 0 (עודף רשומות: 0)

=== 5. רשומות בלי קישור Drive, לפי טבלה/מקור ===
table / source                           | no-link | total | %
FinancialDocumentReview / camera         |       5 |     5 | 100.0%
SupplierPayment / camera                 |       5 |     5 | 100.0%

=== 6. GmailScanItem לפי reviewStatus ===

=== 6b. FinancialDocumentReview לפי reviewStatus ===
needs_review         | 5

=== 7. FDR (source=gmail) עם gmailMessageId ללא GmailScanItem תואם (early-NEEDS_REVIEW gap) ===
FDR מ-gmail עם gmailMessageId : 0
מתוכם ללא GSI תואם            : 0 (-)

=== סוף דוח ===
```
