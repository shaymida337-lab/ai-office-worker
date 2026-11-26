# OpenMontage × אולפן אורן – התקנה, יכולות ומסקנות

## מה הותקן (בפועל)
- ריפו רשמי: `OpenMontageInc/OpenMontage` (‏~83K כוכבים, רישיון **AGPL-3.0**).
  - AGPL: שימוש פנימי להפקת סרטונים – מותר. אם נריץ אותו כשירות רשת לאחרים, חובה לפרסם את קוד המקור של השינויים.
- מיקום: `/opt/tp/OpenMontage` (סביבת `.venv` של Python 3.11, ‏Remotion + HyperFrames דרך npm).
- התקנה חוזרת: `setup/install.sh` (כולל OpenMontage, ‏SadTalker, ‏Wav2Lip, ‏LivePortrait, ‏Chatterbox).
- חיבור ל-Claude Code: OpenMontage הוא "מערכת סוכנים מבוססת קבצים". הסוכן (Claude Code) קורא את `AGENT_GUIDE.md`
  ומפעיל pipelines מתוך `pipeline_defs/*.yaml` ו-skills מתוך `skills/`. אין שרת MCP – החיבור הוא דרך הקבצים והכלים ב-Python.
- `.env` ריק ממפתחות **בכוונה** ⇒ אף ספק בתשלום לא יכול לרוץ. אין הוצאה כספית אפשרית.

## Preflight בפועל (registry.provider_menu_summary) – 26.11.2026
| יכולת | זמין / סה"כ | הערה |
|---|---|---|
| קומפוזיציה (FFmpeg / Remotion / HyperFrames) | 3/3 ✓ | עריכה, כתוביות, מעברים, גרפיקה – חינם |
| video_post | 9/10 ✓ | חיתוך, צבע, מיקס |
| subtitle | 2/2 ✓ | כתוביות (צריך לוודא RTL עברית) |
| analysis | 7/14 | |
| **avatar** | **0/5** | HeyGen, ‏Kling avatar, ‏Kling lip-sync = בתשלום. SadTalker, ‏Wav2Lip = מקומי (מסומן "Requires CUDA") |
| **tts** | **0/19** | כולם API בתשלום חוץ מ-Piper (אין קול עברי רשמי) |
| **video_generation** | **0/35** | כולם API בתשלום או מקומי עם GPU (LTX/Wan/Hunyuan/CogVideo) |
| image_generation | 0/31 | בתשלום / GPU |
| music_generation | 0/8 | בתשלום |

## מסקנה מרכזית
OpenMontage **לא מנפיש דמויות בעצמו**. הוא מנצח (orchestrator): תכנון, תסריט, סטוריבורד, עריכה ורינדור.
איכות הדמות תלויה במודל שמחברים אליו:
- חינמי/מקומי: SadTalker, ‏Wav2Lip ⇒ ראש מדבר מתמונה. איכות של "תמונה שהפה שלה זז" – **לא עומד ביעד 9/10**.
- בתשלום: Kling Avatar / HeyGen / Seedance (דרך fal/Atlas) ⇒ איכות גבוהה, גוף ותנועות. **לא מופעל – אין אישור הוצאה.**

## איך אורן משתלב
OpenMontage = שכבת ההפקה (עריכה, כתוביות, מוזיקה, B-roll, קומפוזיציה, סוכנים).
המנועים שלנו (`oren-studio/scripts`) = שכבת הדמות והקול:
- קול: Phonikud → Chatterbox (נבדק: הגייה מושלמת בעברית, חינם).
- פנים: LivePortrait (נבדק: חד, זהות נשמרת; ‏~5 שניות לפריים על CPU).
- שפתיים: נבדקים SadTalker / Wav2Lip של OpenMontage.

## בדיקה בפועל של כלי האווטאר החינמיים של OpenMontage (פנים לבדיקה בלבד, לא אורן)
| כלי | הרצה | זמן CPU | ציון (1–10) | ליקויים בפועל |
|---|---|---|---|---|
| SadTalker (talking_head) | עבד אחרי 2 תיקוני תאימות numpy | 4 שניות וידאו = 7.4 דקות (פי 110 מזמן אמת) | **3** | ‏256px מטושטש, הפה כמעט לא זז, תנועת ראש קטנה בלבד, אין גוף/ידיים, "תמונה שמדברת" |
| LivePortrait (מנוע שלנו) | עבד | 2 שניות = 5 דקות | 6 לתנועת פנים | חד וטבעי, אבל השפתיים מגיעות מוידאו מניע ולא מהאודיו; אין גוף |
| Wav2Lip (lip_sync) | מותקן, משקלים הורדו | לא נבדק עדיין | – | ידוע: אזור פה 96px מטושטש |

**שורה תחתונה:** הנתיב החינמי של OpenMontage על המכונה הזו (CPU) לא יגיע ל-9/10. הוא כן מתאים לעריכה, כתוביות, גרפיקה ומוזיקה.
דגימות: `samples/bench/`.
