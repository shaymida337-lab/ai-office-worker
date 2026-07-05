# שפת העיצוב של נטלי — התקן לבדיקת מסכים

> חולץ מהקוד (2026-07-05): `lib/design-tokens.ts`, `design-system/`, `globals.css`, `tailwind.config.js`.
> זה התקן שמולו נבדק כל מסך במבצע הייצוב. עברית-קודם, **RTL ברמת ה-html**.

## 1. צבעים

| תפקיד | ערך | שימוש |
|---|---|---|
| **Primary** | `#1D5BFF` | כפתורים ראשיים, קישורים, מצב פעיל (CSS: `--accent-primary`) |
| Primary hover | `#1746C7` | hover/pressed |
| Primary soft / muted | `#E8EEFF` / `#F0F4FF` | רקעי אקצנט עדינים |
| רקע עמוד | `#F4F6FB` + שני radial-gradients עדינים (כחול/ירוק) | `--bg-primary` |
| משטח (card) | `#FFFFFF` | `bg-surface-secondary` / `--bg-card` |
| טקסט ראשי | `#0A0D12` (טוקנים) / `#0e1116` (CSS var) | `text-ink-primary` |
| טקסט משני / מוחלש | `#4B5563` / `#5C6678` | `text-ink-secondary` / `text-ink-muted` |
| גבול | `#DDE3EE` (רגיל) / `#E8EDF5` (עדין) | `--border: #e6eaf2` ⚠️ ערך שלישי |
| הצלחה | טקסט `#065F46`, רקע `#ECFDF5`, גבול `#6EE7B7` | badge-ok |
| אזהרה | `#92400E` / `#FFFBEB` / `#FCD34D` | badge-warn |
| שגיאה | `#991B1B` / `#FEF2F2` / `#FCA5A5` | badge-error; danger-gradient לכפתורים: `#EF4444→#F97316` |
| מידע | `#1E40AF` / `#EFF6FF` / `#93C5FD` | |
| אקצנט KPI | blue/green/amber/violet (`#6D28D9`) | `kpiAccentStyles` |

## 2. טיפוגרפיה

- **גופן:** Heebo (עברית-נייטיב) → system-ui. משקלים 400-800.
- **כלל גודל מינימלי:** 18px לטקסט מוצר (חריגים מותרים: ניווט 15px).
- סולם: כותרת עמוד `text-3xl/4xl bold` · כותרת סקשן `text-2xl bold` · כותרת כרטיס `text-xl bold` · גוף `text-base font-medium` · תווית/עזר `text-xs font-medium` · **KPI:** `text-3xl/4xl font-extrabold tabular-nums`.
- הדשבורד משתמש בסולם px מפורש (`text-[21px]`..`text-[36px]`) — legacy מכוון של מבצע הדשבורד.

## 3. מרווחים, רדיוסים, צל

- **בסיס 4px**; ריפוד עמוד `p-4 md:p-6 lg:p-8`; ריפוד כרטיס `p-6 md:p-7` (או `p-4 md:p-6` ב-.card ה-CSS); מקצב אנכי `gap-8`.
- **מגע מינימלי 44px** (כפתורי CTA מרכזיים: `min-h-[56px]`; שדות: `min-h-[52px]`).
- רדיוסים: `rounded-xl` (12px, controls) · `rounded-2xl` (16px, cards) · `rounded-full` (badges/pills).
- צל כרטיס: `shadow-card` = `0 10px 34px rgba(20,40,90,.08)`; מודאל: `0 20px 56px rgba(15,23,42,0.12)`; זוהר-מיקוד: `shadow-glow`.

## 4. רכיבים חוזרים (המתכונים הקנוניים)

**כרטיס:** `rounded-2xl border border-[var(--border)] bg-white p-4 md:p-6 shadow-card` (מחלקת `.card`) — עם פס-אקצנט עליון אופציונלי 4px בגרדיאנט.

**כפתורים** (`.btn` ב-globals):
- ראשי: רקע `#1D5BFF`, טקסט לבן, `rounded-xl min-h-11`, צל כחלחל, hover scale-1.02 + כהה.
- `.btn-secondary`: לבן עם גבול וטקסט אקצנט. `.btn-danger`: גרדיאנט אדום-כתום.
- ⚠️ קיימות שתי אסכולות hover (scale מול brightness) — ר' §6.

**Badge:** `rounded-full text-xs font-bold` + נקודת ::before — `badge-ok`/`badge-warn`/`badge-error`.

**שדות טופס:** `min-h-11..52, rounded-xl, px-4 py-3, text-[16px]`, focus: גבול אקצנט + ring `rgba(29,91,255,0.14)`.

**Empty state:** רקע `#F0F4FF`, גבול **מקווקו**, אייקון 14×14 ב-`rounded-2xl`, כותרת+הסבר+CTA. עקרון קופי: לא מאשימים את המשתמש, תמיד צעד הבא.

**טבלה:** `min-w-[640px] text-right` בתוך `overflow-x-auto`; כותרות `text-xs font-bold uppercase`; מובייל — כרטיסים (`hidden md:table` / `md:hidden`).

**Toast:** `.toast` — צמוד תחתית במובייל, פינה בדסקטופ, `toastSlide 0.3s`.

**Skeleton:** `.skeleton` עם shimmer 1.4s.

**Layout:** sidebar ימני 15rem (דסקטופ), bottom-nav במובייל; תוכן `max-w-[1400px]`; פריט ניווט פעיל: רקע `#E8EEFF`, פס פנימי 3px בצבע אקצנט.

**תנועה:** 120-480ms, easing `cubic-bezier(0.2,0,0,1)`; חובה `motion-reduce:` בכל אנימציה.

**סכומים:** `formatAmount` מ-`lib/format/amount` — לעולם לא `.toLocaleString` ישיר על שדה nullable (התקן מאז תיקון הקריסה).

## 5. היררכיית מקורות (מי קובע כשיש סתירה)

1. `frontend/src/design-system/` — המערכת הסמנטית החדשה (Sprint 15) — **היעד**.
2. `frontend/src/lib/design-tokens.ts` — ה-legacy הפעיל ברוב המסכים.
3. `globals.css` + tailwind.config — משתני CSS ומחלקות `.btn/.card/.badge`.

## 6. אי-עקביויות ידועות (רשימת הבדיקה של המבצע)

1. **שלוש שכבות טוקנים לא מסונכרנות** — למשל גבול: `#DDE3EE` (טוקנים) מול `#E8EDF5` (subtle) מול `--border: #e6eaf2` (CSS). להחליט על אחד וליישר.
2. **שתי אסכולות hover לכפתורים** — `.btn` עם scale מול patterns עם brightness.
3. **hex קשיחים בקומפוננטות** — `#2563EB` (settings CTA — בכלל לא ה-primary!), `#111827`, `#F8FAFC`, `#CDD9FF` — במקום טוקנים.
4. **סולם px מפורש בדשבורד** מול סולם Tailwind בכל השאר.
5. **KPI value** — token אומר text-3xl, בפועל md:text-4xl במקומות.
6. **פרימיטיבי React מתוכננים ולא קיימים** (Button/Dialog/Toast...) — מתכונים חיים כמחרוזות classes בלבד.
