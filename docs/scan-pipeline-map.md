# מפת צינור סריקת החשבוניות (Gmail → Drive)

> שלב 0 של פרויקט חיזוק הצינור. נכון ל-2026-07-03, HEAD `87e9aee`.
> מיפוי read-only — אין כאן שינויי קוד. מספרי שורות מקורבים לנקודת הזמן הזו.

---

## 1. תרשים זרימה טקסטואלי (מסלול Gmail הראשי)

```
syncGmailForOrganization (gmail-sync.ts:634)
  └─ runGmailSyncForOrganization (:654)   [mutex פר-ארגון, SyncLog: queued→running]
      │
      ├─ FETCH: listCandidateMessages (:4785) / listFastCandidateMessages (:4710)
      │    3 שאילתות Gmail (attachment+keywords / keywords / supplier-keywords)
      │    חלון: initialConnectScanWindow או daysBack=90 | תקרות: 500 sync / 1,000 rescan / 25 quick / 20 fast
      │
      ├─ fetchAndParseMessages (:1062)  [batch=10]
      │    ├─ upsert EmailMessage (@@unique[org,gmailId])
      │    ├─ analyzeAndSaveMessage (messageScanner) — MessageScan נפרד
      │    └─ שגיאה → saveFetchErrorScanItem (GSI reviewStatus=needs_review, stage=fetch_parse_save)
      │
      └─ לולאת עיבוד פר-הודעה (:1518)
           │
           ├─ [D1] כבר עובד? EmailMessage.processedAt קיים
           │        fast-scan: דלג אלא אם pending_repair (driveUploadStatus=pending_retry/failed) (:1547)
           │
           ├─ הרכבת גוף: bodyText + PDF text (:5179) + OCR/Claude על תמונות (:5298)
           │        + ראיות קישורי Drive (evaluateGmailDriveLinkInvoiceEvidence :1611)
           │
           ├─ [D2] classifyJunk (:1627)
           │        CERTAIN_JUNK → processedAt, המשך | NEEDS_REVIEW → recordFinancialDocumentDecision, המשך
           │
           ├─ ניתוח: analyzeEmailContent (Claude) → classifyOcrSupplierText → extractHebrewInvoiceFields
           │        → detectInvoice → resolveGmailOrgMoneyDecision → resolveSupplierMetadata
           │        → classifyBusinessDocument → pipelineActionForClassification
           │
           ├─ [D3] סינון שולח אישי בלי ראיית מסמך (:1830) → דחייה
           │
           ├─ [D4] pipelineAction=NEEDS_REVIEW && !isInvoice (:1844)
           │        → recordFinancialDocumentDecision (payment_request, forceNeedsReview) → המשך
           │        ⚠️ במסלול הזה לא נוצר GmailScanItem — רק FinancialDocumentReview
           │
           ├─ שערי סיווג: FSE → amountGate → supplierGate → trustGate → outcomeGate (:2019-2091)
           │        [D5] gmailOutcomeStopsPersistence → recordFinancialDocumentDecision, המשך (בלי GSI)
           │
           ├─ [D6] dedup: buildGmailScanDuplicateKey (:1986) → קיים עם סכום תקין? דלג
           │        computeCanonicalFingerprint (SCFC) → fingerprintGate → duplicateGate (:2123-2187)
           │
           ├─ [D7] recordFinancialDocumentDecision (:2202)
           │        → action: accepted | filtered | duplicate | needs_review (יוצר/מעדכן FDR)
           │
           ├─ יצירת Client/Lead (רק auto_saved+accepted) (:2259)
           │
           ├─ [D8] העלאת Drive (shouldUploadAttachments :2291)
           │        הצלחה → EmailAttachment.driveLink, status=uploaded
           │        כישלון → status=pending_retry (retry נפרד, עד 20 בכל ריצה)
           │
           ├─ GmailScanItem upsert (:2541) — תמיד במסלול הראשי
           │        reviewStatus = "auto_saved" | "needs_review" בלבד
           │        duplicateKey = documentFingerprint (SCFC)
           │
           ├─ [D9] Invoice (לקוח): isCustomerInvoice && clientId (:2683)
           │        פר-attachment: analyzeInvoiceAttachmentForEmail → saveDetectedInvoice (invoiceDedupeKey)
           │
           ├─ [D10] SupplierPayment (ספק): supplierPaymentCreationEligibility (:2864)
           │        → evaluateFinanceTrustGates → findExistingSupplierPayment
           │        → קיים? update+merge sources | חדש? createSupplierPaymentIfTrusted (:3049)
           │
           ├─ [D11] fallback: accepted+relevant אבל שום דבר לא נוצר (:3201)
           │        → recordFinancialDocumentDecision(forceNeedsReview, "no invoice or supplier payment was created")
           │
           └─ EmailMessage.processedAt = now (:3241)
                שגיאה בעיבוד → saveRejectedScanItem או GSI→needs_review + processedAt (:3252)
```

מסלולי כניסה נוספים (מתמזגים ב-`recordFinancialDocumentDecision`):
- **WhatsApp**: `whatsappInvoiceIngestion.ts` → `ingestWhatsAppInvoiceMedia` → fileSha256 מחושב → אותו gate.
- **מצלמה/ידני**: `routes/api.ts` (POST camera-invoice) → source="camera", **בלי fileSha256**.
- **Client Gmail (legacy)**: `clientGmailSync.ts` — מנגנון החלטה נפרד (`decideClientGmailFinancialDocumentDuplicate`), hash legacy.

---

## 2. חילוץ שדות — ספק / סכום / תאריך

### 2.1 ספק
סדר עדיפויות (supplier/supplierCandidates.ts, resolveSupplierMetadata):
1. Claude analysis.supplier
2. מועמדי תווית מסמך / OCR-keywords (עיריות, בזק, סלקום... — רשימה קשיחה gmail-sync.ts:375-541)
3. מועמד היסטורי (ספק מוכר לארגון)
4. fallback לשם/דומיין השולח

ולידציה: `supplierNameValidation.ts` — `isLikelyJunkSupplierName` (:39-62):
placeholders ("לא ידוע", "unknown"...), אורך>60, prefix של רשימה ממוספרת, דליפות-פרומפט
("rawocr", "extract", "for example"...), תווי קוד `()[]{}=<>|`, שמות דבוקים PascalCase.
נצרך ב: financialDocuments.ts:1008, gmail-sync.ts:5700, supplierGate.ts:116, supplierValidation.ts:96, reprocessFinancialDocument.ts:247.

### 2.2 סכום
- `parseAmount.ts`: זיהוי מפרידים (US/EU), `ambiguous` על סגמנט 3 ספרות בלי תווית חזקה,
  חיובי בלבד, תקרה `MAX_PARSE_AMOUNT = 1,000,000`.
- `extractInvoiceAmount` (gmail-sync.ts:5757): ניקוד — "סה\"כ לתשלום"=100, מילות מפתח=80-100, סמלי מטבע=80; בחירת קונצנזוס.
- `financialAmountLimits.ts`: תקרות ביקורת — קבלה 25K, חשבונית מס 250K, דרישת תשלום 100K.
- מטבע: זיהוי $/€, ברירת מחדל ILS (claude.ts:224).

### 2.3 תאריך
- `normalizeBusinessDate` (gmail-sync.ts:5911): parse + **גבול ±2 שנים** מהיום, אחרת fallback (receivedAt).
- `parseDate` (financialDocuments.ts:979): parse בלבד, **בלי גבולות**.
- invoiceExtractor: זיהוי פורמט YYYY-MM-DD מול DD-MM-YYYY לפי אורך הסגמנט הראשון.

| מסלול | נירמול תאריך | גבול ±2 שנים |
|---|---|---|
| Gmail (גוף/attachment) | `normalizeBusinessDate(..., receivedAt)` | ✅ |
| WhatsApp | `analysis.invoiceDate` ישירות | ❌ |
| מצלמה/ידני | `new Date(body.invoiceDate)` — קלט משתמש | ❌ (רק isNaN) |

---

## 3. מנגנוני כפילויות

### שכבות (מהחדש לישן)
1. **SCFC documentFingerprint** (`dedup/sharedMatcher.ts:164`) — טירים לפי עדיפות:
   `file` (SHA256) → `invoice-amount` → `tax-invoice` → `supplier-amount-date` → `weak` → `none`.
   נאכף ב-unique: `SupplierPayment@@unique[org,documentFingerprint]`, `FinancialDocumentReview@@unique[org,documentFingerprint]`.
2. **sourceFingerprint** (financialDocuments.ts:125) — פר-מקור (source+sender+fileSize+amount+invoiceNumber+date). אינדקס בלבד.
3. **duplicateHash legacy** (`lib/duplicate.ts:4`) — org|supplier|amount|date|subject → SHA256/32.
   `SupplierPayment@@unique[org,duplicateHash]`.
4. **GmailScanItem.duplicateKey** — `buildGmailScanDuplicateKey` (legacy) בזמן בדיקה מוקדמת (:1986),
   אבל בשמירה בפועל duplicateKey = documentFingerprint (:2541). `@@unique[org,duplicateKey]`.
5. **duplicateGate** (`dedup/duplicateGate.ts:97`) — pass/review/block + קודי סיבה
   (confirmed_match, file_hash_match, invoice_amount_match, semantic_unsure, cross_channel_unsure, key_mismatch, rescan_*...).
6. **fingerprintGate** (`dedup/fingerprintGate.ts:156`) — טיר חלש/חסר → review; יציבות זהות ב-rescan.
7. **source dedup** (`dedup/supplierPaymentSourceDedup.ts:77`) — התאמה לפי documentFingerprint / emailMessageId / gmailMessageId; נבחר הישן ביותר.

### חיפוש מועמדים (buildSupplierPaymentLookupClauses)
documentFingerprint → legacy fingerprints → sourceFingerprint → legacyDuplicateHash → invoiceNumber+amount → supplier+amount+date(יום).

---

## 4. תיוק Drive

### מבנה תיקיות (`driveService.ts:989`)
```
[root מ-config] / Clients / [לקוח|"לקוח לא מזוהה"] / [YYYY] / [MM - חודש עברי] /
    Suppliers / [ספק|"לא זוהה"] / [Invoices | Receipts | Needs Review]
```
בחירת קטגוריה (:1010): needs_review/ספק לא ידוע/סוג לא ודאי → "Needs Review"; אחרת לפי סוג.

### שם קובץ (:1064)
`{supplier}_{invoiceNumber}_{YYYY-MM-DD}_{amount}{ext}` — למשל `acme_INV-123_2026-06-15_500.50.pdf`.

### התנהגות כשל
- כפילות בהעלאה → `duplicateDetected:true`, לוג DRIVE_DUPLICATE_SKIPPED, ממשיכים.
- כשל העלאה → `driveUploadStatus="pending_retry"`, לוג DRIVE_UPLOAD_FAILED, **הקליטה לא נעצרת**.
- `retryPendingDriveUploads` — עד 20 pending_retry בריצה.

### שדות קישור פר-מודל
| מודל | שדות |
|---|---|
| EmailAttachment | driveFileId, driveLink, driveFolderId, driveClientFolderId, driveSupplierFolderId, driveFolderPath |
| GmailScanItem | driveFileLink, driveUploadStatus |
| FinancialDocumentReview | driveFileUrl, driveUploadStatus |
| SupplierPayment | documentLink, invoiceLink, driveFileId, driveFileUrl, driveFolderId, ..., driveFolderPath |
| Invoice | driveUrl, driveFileId, driveFileUrl, driveFolderId, ..., driveFolderPath |

⚠️ אין סכימת שמות אחידה (driveLink / driveFileLink / driveFileUrl / driveUrl / documentLink).

---

## 5. סטטוסים ותצוגה (ה"חשבונית הנעלמת")

### מי כותב מה
- **GmailScanItem.reviewStatus**: הסורק כותב רק `auto_saved` | `needs_review` (:3445).
  אישור ידני: `POST /gmail-scan-items/:id/approve` (api.ts:5585) → `approved`.
- **FinancialDocumentReview.reviewStatus**: `needs_review` | `approved` | `rejected` | `duplicate`.

### מי קורא מה
- `GET /document-reviews` (api.ts:5506): פילטר `reviewStatus=needs_review|approved|all` — FDR בלבד.
- `GET /invoices` (api.ts:4328): ממזג Invoice+GSI+FDR; `buildReviewCandidateStatuses` (api.ts:3774)
  מחזיר רק `["needs_review"]/["rejected"]/["approved"]` או שלושתם — **לעולם לא `auto_saved`**.
- `GET /payments` (api.ts:4697): `approvalStatus="approved"` קשיח.
- `GET /message-scans`: בלי פילטר סטטוס בכלל.

### הבאגים המאומתים
1. **auto_saved נעלם**: GSI עם `reviewStatus="auto_saved"` לא נכלל באף טאב ב-invoices
   (needs_review/approved/rejected/ברירת-מחדל-שלושתם) → נעלם מה-UI לחלוטין.
2. **approved של GSI**: אחרי אישור ידני GSI מקבל `approved` ומופיע רק בטאב approved של `/invoices`;
   דף document-reviews לא טוען GSI בכלל — חוסר עקביות בין שני המסכים.

---

## 6. נקודות כשל אפשריות (ממופה → שלבי התיקון)

| # | נקודת כשל | מיקום | שלב מתקן |
|---|---|---|---|
| F1 | ספק junk: דליפת ערכים טכניים מ-Claude/OCR, fallback לשולח, שמות דבוקים | supplierCandidates, supplierNameValidation | שלב 2 |
| F2 | fallback רגקס של invoiceExtractor: תאריך=היום כשאין תאריך; amount=0 גם ל"אין התאמה" וגם לאפס מפורש (invoiceExtractor.ts:101-104) | invoiceExtractor | שלבים 2-3 |
| F3 | סכום ambiguous עם תווית חזקה עדיין נפרש (110.723→110723) | parseAmount.ts:149 | שלב 3 |
| F4 | תאריך בלי גבולות ב-WhatsApp ובמצלמה (עתידי/עתיק נכנס ל-DB) | whatsappInvoiceIngestion.ts:106, api.ts:6944 | שלב 3 |
| F5 | מצלמה בלי fileSha256 → טיר fingerprint חלש → dedup חלש | api.ts camera endpoint | שלב 4 |
| F6 | GSI duplicateKey legacy בבדיקה מוקדמת מול SCFC בשמירה — שני מפתחות שונים לאותו פריט | gmail-sync.ts:1986 מול :2541 | שלב 4 |
| F7 | FDR כפול: recordFinancialDocumentDecision על אותו מסמך פעמיים (unique רק על documentFingerprint — טיר weak/none → fingerprint null → אין הגנה) | financialDocuments.ts | שלב 4 |
| F8 | Invoice לקוח: unique [org,client,emailId,invoiceNumber] — emailId יכול להיות null | schema.prisma:398 | שלב 4 |
| F9 | OutgoingInvoiceDraft — אין dedup לפני יצירה (רק קיבוץ אחרי) | findDuplicateDrafts.ts | מחוץ להיקף? לתעד |
| F10 | כשל Drive → pending_retry אבל retry מוגבל ל-20 ואין התראה מצטברת | driveService.ts:211 | שלב 5 |
| F11 | קישור Drive נשמר ב-5 סכימות שמות שונות; חלק מהמסלולים לא מעדכנים את כולן | ר' טבלה §4 | שלב 5 |
| F12 | auto_saved לא מוצג באף רשימה; approved של GSI לא בדף document-reviews | api.ts:3774, frontend | שלב 6 |
| F13 | early-NEEDS_REVIEW path לא יוצר GSI — הפריט קיים רק כ-FDR (ספירות שונות בין מסכים) | gmail-sync.ts:1844 | שלב 6 |
| F14 | שגיאת עיבוד אחרי scanItemPersisted → GSI נדרס ל-needs_review גם אם כבר auto_saved | gmail-sync.ts:3262 | שלב 6 |
| F15 | clientGmailSync במנגנון dedup נפרד (legacy) — עלול לייצר רשומות שהצינור הראשי לא רואה | clientGmailSync.ts:270 | שלב 4 (לתעד לפחות) |

---

## 7. קבועים מרכזיים

| קבוע | ערך | מיקום |
|---|---|---|
| MAX_MESSAGES_PER_SYNC / RESCAN / QUICK / FAST | 500 / 1,000 / 25 / 20 | gmail-sync.ts:119-122 |
| GMAIL_SCAN_BATCH_SIZE | 10 | :123 |
| daysBack ברירת מחדל | 90 | :721 |
| MAX_PARSE_AMOUNT = MAX_REASONABLE_FINANCIAL_AMOUNT | 1,000,000 | parseAmount.ts:29, financialAmountLimits.ts:1 |
| תקרות ביקורת: קבלה / חשבונית מס / דרישת תשלום | 25K / 250K / 100K | financialAmountLimits.ts:4-10 |
| גבול תאריך עסקי | ±2 שנים | gmail-sync.ts:5911 |
| ספי ביטחון | high ≥0.78+2 ראיות; medium ≥0.5 | gmail-sync.ts:4370 |
| אורך שם ספק מקס' | 60 | supplierNameValidation.ts:10 |
