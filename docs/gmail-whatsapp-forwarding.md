# WhatsApp → Gmail forwarding (MVP — Israel)

For MVP we **do not** connect WhatsApp Business API. Staff forwards documents to the same Gmail inbox that Make.com scans.

---

## Recommended workflow

1. Supplier sends invoice on **WhatsApp** (PDF or image).
2. On your phone: open the file → **Share** or **Forward**.
3. Choose **Gmail** → send to **your business Gmail** (same account connected to Make.com).
4. In subject/body add one word: `WhatsApp` (helps filters).
5. Within 24h the daily Make scenario processes it like any other email.

---

## Gmail filter (after first test forward)

1. Forward one test document from WhatsApp to Gmail.
2. Open the received mail — note the **From** address (may be your phone or `via` address).
3. **Settings → Filters → Create filter**
   - Has words: `WhatsApp` OR `וואטסאפ`
   - Or **From** contains your phone email if Gmail shows it
4. Actions:
   - Apply label: `WhatsApp-Forwarded`
   - Never send to spam

---

## Team instructions (Hebrew — copy to staff)

```
חשבוניות ומסמכים מוואטסאפ:
1. פתחו את הקובץ בוואטסאפ
2. שלחו ב-Gmail לכתובת: YOUR_GMAIL@gmail.com
3. בנושא כתבו: WhatsApp + שם הספק
4. המערכת תסווג אוטומטית תוך יום עסקים
```

---

## Make.com handling

- Set column **Source** = `WhatsApp-Forward` when label `WhatsApp-Forwarded` is present.
- Same AI prompt and Drive paths as regular Gmail.
- Optional: route to `AI-Office-Worker/Receipts/{Supplier}/` when `document_type` = receipt.

---

## Limitations (know before go-live)

| Limitation | Workaround |
|------------|------------|
| Manual forward | Train staff; weekly reminder |
| No chat text context | Put supplier name in subject |
| Images only in WhatsApp | Forward as attachment, not screenshot if possible |
| Volume | Daily batch at 07:00 is enough for MVP |

---

## Later upgrade path

When moving to **Google Workspace** + budget:

- WhatsApp Business Platform → webhook → Make.com HTTP module
- Or dedicated `@docs.yourdomain.co.il` inbox
