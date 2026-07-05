# מסך settings — ממצאי חקירה + תוכנית תיקון (מבצע מסכים)

> חקירה read-only (2026-07-05), אפס שינויי קוד. קובץ יחיד: `dashboard/settings/page.tsx` (752 שורות).

## 1. באג ה-OAuth הנבלע — אושר במדויק 🔴

**שורה 132:** `if (window.location.search.includes("gmail=connected"))` — זה **הטיפול היחיד** בפרמטרי החזרה מ-OAuth. ה-backend מחזיר גם `?gmail=error&reason=<...>` ו-`?gmail=invalid_state` (oauthReturn.ts) — שניהם נבלעים לחלוטין. זה הבאג המוכח: `token_already_bound` היה בשורת הכתובת והמסך שתק.

**תיקון:**
- פונקציה טהורה חדשה `oauthReturnMessage(params)` ב-`lib/integrations/oauthReturnMessages.ts` — ממפה `{provider, status, reason}` → `{tone: "success"|"error", text}` בעברית:
  - `token_already_bound` → "חשבון ה-Gmail הזה כבר מחובר לארגון אחר. נתק אותו שם (הגדרות → נתק ג'ימייל) ונסה שוב."
  - `invalid_state` → "החיבור פג תוקף (עברו יותר מ-10 דקות). נסה לחבר שוב."
  - `error` + reason אחר → "החיבור נכשל: <reason מקוצר>"
  - `connected` → ההודעה הקיימת. תמיכה גם ב-`calendar=`.
- שימוש ב-useEffect הקיים + `router.replace` לניקוי ה-URL (קיים).
- **טסטים** על הממפה (כולל מניעת רגרסיה ל-token_already_bound).
- סוגר את כרטיס המשימה הפתוח (task_31bff1dd).

## 2. ה-null-guard של social/status — אושר 🔴

**שורה 161:** `setSocialStatus(data.platforms)` — תשובה בלי `platforms` (מוקים/גרסת backend/שגיאה) → ה-state הופך `undefined` → **שורה 424** `socialStatus.find(...)` קורסת. בדיוק הקריסה שנצפתה ב-QA של שלב 1.

**תיקון:** `Array.isArray(data?.platforms) ? data.platforms : []`. אותו דפוס שביר גם בשורה 149: `setBusinessProfile(data.businessProfile)` → `data?.businessProfile ?? ""`.

## 3. סטיות מהתקן העיצובי 🟠

| מיקום | סטייה | תיקון |
|---|---|---|
| שורה 326 — טאב פעיל | `bg-[#6366F1]` — **אינדיגו שלא קיים בכלל בפלטה** + צל סגול | דפוס פריט-ניווט-פעיל מהתקן: רקע `accentSoft #E8EEFF`, טקסט accent, בלי צל צבעוני (או primary מלא — הכרעה בביצוע) |
| שורות 327 | `text-[#6b7686]`, `hover:text-[#0e1116]` — **הערכים הישנים מלפני איחוד הטוקנים**, קפואים כ-hex | `text-ink-secondary` / `hover:text-ink-primary` |
| שורה 373 | `border-[#e6eaf2]`, `placeholder:text-[#6b7686]` — כנ"ל | `border-[var(--border)]` / `placeholder:text-ink-muted` |
| שורה 315 — הודעת המצב | **סגנון אחד (כחלחל) גם לשגיאות** — לכן גם עם תיקון #1 שגיאה הייתה נראית כהצלחה | tone-aware: שגיאה בערכת danger (`#FEF2F2/#FCA5A5/#991B1B`), הצלחה בערכת success |
| שורה 324 | `text-[15px]` בטאבים | נשאר — חריג הניווט המותר בתקן (15px) |

הערה: אחרי איחוד שלב 1, ה-hex הקפואים האלה **בולטים כסטייה נראית** (הם בגווני האפור הישנים).

## 4. סקירה כללית 🟡

- **Loading/double-submit:** רק green-invoice מוגן (`disabled={greenInvoiceLoading}`). טפסי רו"ח ו-WhatsApp — בלי מצב שמירה → אפשר דאבל-סאבמיט. תיקון: state `saving` + disabled + "שומר...".
- **שגיאות טעינה:** רוב ה-loads עם `.catch(() => undefined)` — שקט מקובל לסטטוסים; נשאר.
- **כפתורים:** "פתח מודול סושיאל"/"פתח הגדרות וואטסאפ" → ניווטים תקינים; פעולות Gmail אומתו בסאגת ה-OAuth.
- **מובייל/RTL:** לוודא בביצוע ש-שורת הטאבים (7 טאבים) נגללת אופקית במובייל בלי לשבור את העמוד (`overflow-x-auto` על המיכל).

## היקף ואימות

- **קבצים:** page.tsx + קובץ ממפה חדש + טסט — **commit ממוקד אחד**.
- **סיכון:** נמוך. שינויי תצוגה/הגנות בלבד; אפס שינוי ב-flows.
- **אימות:** build + סוויטה + visual-QA לפני/אחרי של settings (כלי הצילום הקיים; המוקים כבר מכסים) + בדיקת ידנית של `?gmail=error&reason=token_already_bound` ב-URL מקומי.
