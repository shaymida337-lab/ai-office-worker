# מפקד מסכים — מבצע ייצוב מסכים (שלב 0)

> נוצר 2026-07-05. read-only — שום מסך לא שונה. זהו הבסיס לעבודה מסך-מסך.
> התקן העיצובי שמולו בודקים: [design-tokens.md](design-tokens.md).

**סיכום:** ~57 routes | 26 בניווט (חלקם מותנים במודול) | 11 קיימים אך כבויים בניווט | 9+ ציבוריים.

## מסכי הליבה (בניווט)

| מסך | נתיב | ~שורות | תפקיד | סטטוס ראשוני |
|---|---|---|---|---|
| לוח בקרה | `/dashboard` | 480 | בית: תדריך בוקר, פיד פעילות, בריאות מערכת | נראה תקין (עבר מבצע Phase 1-11) |
| חשבוניות | `/dashboard/invoices` | **1342** | ניהול חשבוניות ספקים — טאבים, חודשים, מחיקה | 🔶 חשוד: הדף הגדול במערכת; קרס לאחרונה על amount=null (תוקן); מועמד לפיצול |
| תשלומים | `/payments` | 419 | תור תשלומי ספקים, סימון-שולם, צירוף חשבונית | לבדוק עקביות עם /invoices |
| יומן | `/dashboard/calendar` | **1067** | תיאום תורים + calendar engine | 🔶 גדול; רכיבי month-view חונים בענף WIP |
| לקוחות | `/dashboard/clients` (+`[clientId]` 551) | 253 | רשימת לקוחות + דף לקוח | `[clientId]` בלי טיפול 404 ל-id שגוי |
| משימות | `/tasks` | 182 | רשימת משימות | נראה תקין |
| גבייה | `/collections` | 158 | חשבוניות לקוח (receivables) | 🔶 חפיפה תמטית עם /payments; UI מינימלי; פורמט סכום לא-מוגן (מהחקירה הקודמת) |
| טיוטות חשבוניות | `/dashboard/invoice-drafts` | 399 | אישור/הנפקת טיוטות | נראה תקין |
| ייבוא חשבוניות | `/dashboard/invoice-import` | 441 | העלאת CSV/Excel בשלבים | נראה תקין |
| מצלמה | `/camera` (מודול documents) | 145 | צילום/העלאת חשבונית | עודכן בשלב 5 (Drive) — לוודא UX שגיאות |
| הגדרות | `/dashboard/settings` | 752 | אינטגרציות (Gmail/WhatsApp/רו"ח/סושיאל) | 🔴 ידוע כבעייתי: בולע שגיאות OAuth callback (`?gmail=error&reason=`) — כרטיס משימה פתוח |
| הגדרות עסק | `/dashboard/business-settings` | 46 | סוג עסק ומודולים | נראה תקין |
| בנק | `/dashboard/bank` | 440 | התאמות דף בנק | לבדוק |
| רו"ח | `/dashboard/accountant` | 126 | סיכום מע"מ/רווח + הורדת ZIP | נראה תקין |
| מכירות | `/dashboard/sales` | 463 | עסקאות/הצעות (kanban) | לבדוק חפיפה עם /crm |
| CRM | `/crm` (מודול crm) | 805 | לידים, pipeline, רצפי הודעות | 🔶 גדול; חפיפה רעיונית עם sales |
| וואטסאפ | `/dashboard/whatsapp` (מודול) | 289 | דיאגנוסטיקת אינטגרציה | לבדוק |
| סושיאל | `/social` (+approve/[token] 118) | 301 | פרסום ואישור פוסטים | לבדוק |
| סריקות הודעות | `/message-scans` | 294 | סיווג הודעות נכנסות | בלי פילטר סטטוס (מתועד ממפת הצינור) |
| דוחות | `/reports` | 87 | חשבוניות חסרות | דל — האם עדיין נחוץ? |
| נטלי (צ'אט) | `/natalie` | 479 | 🔶 דמו צ'אט עם נתונים **מוקיים** | 🔴 פרוטוטיפ ישן? הווידג'ט האמיתי חי בכל המסכים — מועמד להסרה/איחוד |

## מסכי אדמין/דיבוג (מודול admin)

| מסך | נתיב | ~שורות | הערות |
|---|---|---|---|
| admin-debug | `/dashboard/admin-debug` | 704 | 🔴 שורות DB גולמיות; ההגנה היא רק נראות-בניווט — לוודא הרשאה בצד שרת |
| דיוק | `/dashboard/system/accuracy` | 253 | auto-refresh כל 60ש' על שאילתה יקרה |
| אימות | `/dashboard/system/verification` | 339 | מרכז אימות עם פילטרים |
| אבחון חשבוניות | `/dashboard/invoice-diagnostics` | 285 | לוגים של הסורק |

## חיוב (11 תתי-מסכים, מאחורי auth)

`/billing` + plans/checkout/subscription/trial/trial-ending/value-report/manage/payment-method/restricted/reactivate/success/failed/dev — מונחים ע"י BillingRouteGuard לפי מצב מנוי. 🔶 `manage` הוא mock מוצהר ("no real execution this sprint"); `dev` הוא מחליף-מצבים ל-QA (NODE_ENV בלבד).

## ציבוריים/סטטיים

`/` (נחיתה), login, signup, auth/callback, onboarding, status, privacy (+privacy-policy redirect), terms, security, cookies, data-deletion, contact, about, company. 🔶 `company` מערבב פרטי חברה עם הסבר OAuth — מועמד לאיחוד עם about/security.

## חשדות רוחביים (סדר עדיפויות מוצע לייצוב)

1. **🔴 settings** — בליעת שגיאות OAuth (באג פרודקשן מוכח, כרטיס פתוח).
2. **🔴 invoices (1342 שורות)** — הדף הכבד והשביר ביותר; קרס לאחרונה; פיצול + יישור לטוקנים.
3. **🔶 /natalie הדמו** — נתונים מוקיים בפרודקשן; להסיר או לחבר לאמיתי.
4. **🔶 routes כבויים-אך-נגישים (11)** — נגישים ב-URL ישיר בלי בדיקת מודול בצד המסך.
5. **🔶 עקביות פורמט סכומים** — formatAmount המשותף קיים; לאמץ ב-collections/reports/bank/crm/accountant (מיפוי מלא בחקירת ה-null מ-2026-07-05).
6. **🔶 שלוש שכבות טוקנים לא מסונכרנות** — ר' design-tokens.md §אי-עקביויות.
7. אין הפרדת layout בין ציבורי לאפליקציה; `[clientId]` בלי 404.
