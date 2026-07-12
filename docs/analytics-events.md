# מילון אירועי Analytics — אתר שיווקי (GTM dataLayer)

כל האירועים נדחפים ל-`window.dataLayer` (קונטיינר `GTM-WK6B677Q`, production בלבד).
**אסור PII ואסור תוכן טופס/תמלול באירועים.** פרמטרי `source/medium/campaign` מצורפים כשקיימים (נגיעה ראשונה, sessionStorage).

| אירוע | מתי | פרמטרים |
|---|---|---|
| `page_view` | כל ניווט SPA | `page_path` |
| `pricing_view` | סקשן המחירים נכנס לראשונה ל-viewport | utm |
| `pricing_plan_select` | קליק CTA בכרטיס מסלול | `plan` (starter/growth), utm |
| `trial_cta_click` | קליק על CTA ניסיון | `location`, `plan?`, utm |
| `lead_form_start` | פוקוס ראשון בטופס הלידים | utm |
| `lead_form_submit` | שליחת הטופס (לפני תשובת שרת) | utm |
| `lead_form_success` | השרת אישר שמירה ב-DB | utm |
| `lead_form_error` | כשל שליחה | `reason` (status/network), utm |
| `thank_you_view` | טעינת דף התודה | utm |
| `demo_to_lead_click` | קליק "ניסיון 14 יום" מעמוד הדמו | — |
| `referral_share` | קליק שיתוף בוואטסאפ בדף התודה | `channel` |
| `demo_voice_start/success/error/denied` | מיקרופון בדמו (Sprint 3.1) | — |

הערה: הגדרת ה-tags/GA4 בתוך קונטיינר ה-GTM עצמו מנוהלת בממשק GTM (לא בקוד).
