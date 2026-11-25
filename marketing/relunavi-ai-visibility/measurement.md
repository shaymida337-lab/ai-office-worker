# מדידת תנועה ורכישות ממנועי AI — RELUNAVI

## א. שאילתות Shopify (ShopifyQL) — להרצה שבועית
```
FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout
GROUP BY utm_source, referrer_name SINCE -7d UNTIL today ORDER BY sessions DESC LIMIT 30
```
```
FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout
WHERE utm_source = 'chatgpt.com' GROUP BY landing_page_path SINCE -7d UNTIL today ORDER BY sessions DESC
```
```
FROM sessions SHOW sessions WHERE utm_source = 'chatgpt.com' TIMESERIES week SINCE -90d UNTIL today
```
מקורות AI לזיהוי: `utm_source=chatgpt.com` (ChatGPT מוסיף אוטומטית), ו-referrer `perplexity.ai`, `gemini.google.com`, `copilot.microsoft.com`.

### נקודת בסיס (90 יום עד 25.11.2026)
| מקור | סשנים | הוספה לסל | הגיעו לקופה | השלימו |
|---|---|---|---|---|
| chatgpt.com | 80 | 17 | 16 | 1 |
| ישיר | 851 | 16 | — | 0 |
| פייסבוק + אינסטגרם | 54 | 3 | — | 0 |
| גוגל אורגני | 4 | 0 | — | 0 |

דף נחיתה מ-ChatGPT: דף הבית 65, מעסה ברכיים 9, אחרים 1 כל אחד. שבוע השיא: 2.11 (52 סשנים).

## ב. פרוטוקול מדידת הופעה בתשובות AI (ידני, שבועי)
1. מצב גלישה בסתר, חשבון ללא היסטוריה (או ChatGPT בשיחה זמנית / Temporary chat).
2. לכל שאלה: ChatGPT, Gemini, Perplexity, Google AI Mode. שיחה חדשה לכל שאלה.
3. לרשום: האם RELUNAVI הוזכרה (כן/לא), מיקום, איזה מוצר, איזה מקור צוטט, אילו מתחרים הוזכרו.
4. **שיעור הופעה** = שאלות שבהן הוזכרה ÷ סך השאלות, לכל מנוע בנפרד.

20 שאלות קבועות למעקב:
מעסה ברכיים מומלץ · מכשיר עיסוי ברכיים עם חימום · מכשיר עיסוי לצוואר ולכתפיים מומלץ · מעסה קרקפת חשמלי מומלץ · מכשיר עיסוי ביתי מומלץ · חגורת עיסוי חשמלית מומלצת · מסכת שינה עם בלוטות' מומלצת · מתנות מפנקות להורים · מתנה לאמא שיש לה הכול · מתנה לאבא שלא צריך כלום · אקדח עיסוי מומלץ · מכשיר עיסוי לגב מומלץ · מכשיר עיסוי עד 200 ש"ח · כמה עולה מעסה ברכיים מחומם · מכשיר עיסוי לעבודה מול מחשב · האם צריך שני מעסי ברכיים · מכשיר עיסוי עם משלוח חינם בישראל · מעסה צוואר שמרגיש כמו ידיים · מסכת עיניים לשינה עם אוזניות · איפה לקנות מכשיר עיסוי באינטרנט בישראל

## ג. מעקב אוטומטי
משימה מתוזמנת שבועית **"RELUNAVI — מעקב שבועי מנועי AI"** (`trig_01VaUmwoG4AC1rDYt3jwwi1d`): כל יום ראשון 10:23 שעון ישראל, עם התראה לטלפון. הריצה הראשונה ב-29.11.2026.
- פועל כבר עכשיו: בדיקת קטלוג הסוכנים (UCP) ל-8 ביטויי היעד, ובדיקת גישת בוטי AI.
- **דורש פעולה שלכם:** המשימה נוצרה בלי חיבור Shopify (אי אפשר לצרף מחברים מכאן). כדי שהדוח יכלול סשנים, הוספות לסל ורכישות, הוסיפו את המחבר Shopify למשימה בעמוד המשימות המתוזמנות ב-claude.ai.
