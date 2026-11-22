# Shot tuple: (source, t_in, t_out, x_center, zoom=1.0, y_center=None). Sources = RELUNAVI's own N7 store videos.
# Clean ranges only (crossfades at ~2.9-3.3, 7.6-8.6, 12.0-12.7, 18.9-19.3, 24.9-25.4, 44.4-44.8, 52.0-52.6 excluded).
# Neck/shoulder use only. Excluded: 25-44s (leg/back use not claimed for N7) and 54.6s+ / n7_main 3s+ (end card with price).
CLOSE_MAIN = ("n7_main", 0.0, 2.85, 480, 1.1, 900)        # extreme close-up: hand-like heads + heat glow
CLOSE_FD   = ("n7_full_demo", 19.4, 24.8, 470, 1.05, 950)  # close-up kneading on neck
CLOSE_END  = ("n7_full_demo", 52.7, 54.4, 520, 1.0)        # close-up glow
RECLINE    = ("n7_full_demo", 0.0, 2.8, 470)               # woman reclining, eyes closed
RECLINE2   = ("n7_full_demo", 8.7, 11.9, 470)
PROFILE    = ("n7_full_demo", 3.4, 7.5, 520)               # woman with device on shoulders, profile
BACK       = ("n7_full_demo", 12.8, 18.8, 460)             # back view, leaning forward, heads working
COUPLE     = ("n7_full_demo", 44.9, 51.9, 520)             # man using it, partner beside him
def part(shot, a, b):
    s = list(shot); s[1], s[2] = a, b; return tuple(s)
END = "N7 · עיסוי לצוואר ולכתפיים"

SPECS = [
 dict(id="RLN-N7-V01", product="N7", approach="A Curiosity", bucket="8-10s",
      hook="למה למכשיר הזה יש ידיים?",
      vo="למה יש לו ידיים? | כדי ללוש את הכתפיים | בתנועה שמדמה ידיים. | RELUNAVI N7, | הקישור בפרופיל.", rate="+16%",
      shots=[part(CLOSE_MAIN, 0.0, 2.6), part(CLOSE_FD, 19.4, 22.6), part(BACK, 13.0, 15.0), CLOSE_END],
      hook_until=2.6, end=END, end_len=1.4),
 dict(id="RLN-N7-V02", product="N7", approach="B Pain to Relief", bucket="11-15s",
      hook="הכתפיים עמוסות\nבסוף יום העבודה?",
      vo="יושבים כל היום מול המחשב? | והכתפיים מרגישות עמוסות בערב? | מניחים את N7 על הכתפיים, | מפעילים את העיסוי והחימום, | ונשענים אחורה לרגע של רוגע. | הקישור בפרופיל.",
      shots=[part(BACK, 12.8, 16.3), part(CLOSE_FD, 19.4, 22.0), part(PROFILE, 3.6, 6.4), RECLINE, RECLINE2, CLOSE_END],
      hook_until=3.0, end=END, end_len=1.4),
 dict(id="RLN-N7-V03", product="N7", approach="C Satisfying Demo", bucket="8-10s",
      hook="תסתכלו על התנועה הזאת",
      vo="תסתכלו על התנועה. | ראשי עיסוי דמויי ידיים, | עם חימום נעים. | רגע של רוגע בבית.", rate="+12%",
      shots=[CLOSE_MAIN, part(CLOSE_FD, 19.4, 23.8), CLOSE_END], min_len=8.5,
      hook_until=2.85, end="N7 · הקישור בפרופיל", end_len=1.3),
 dict(id="RLN-N7-V04", product="N7", approach="D Storytelling (gift)", bucket="16-20s",
      hook="מתנה למי שתמיד אומר:\n\"אני לא צריך כלום\"",
      vo="יש לכם מישהו שתמיד אומר שהוא לא צריך כלום? | ובערב הכתפיים שלו עמוסות? | אז במקום עוד מתנה שתישאר במגירה, | תנו לו רגע של רוגע אחרי יום ארוך. | מכשיר עיסוי לצוואר ולכתפיים, עם חימום. | RELUNAVI N7. | הקישור בפרופיל.",
      shots=[part(COUPLE, 44.9, 48.2), part(BACK, 12.8, 15.6), part(CLOSE_FD, 19.4, 22.2), part(COUPLE, 48.2, 51.9), part(CLOSE_MAIN, 0.0, 2.85), part(RECLINE, 0.0, 2.8), CLOSE_END],
      hook_until=3.1, end=END, end_len=1.4),
 dict(id="RLN-N7-V05", product="N7", approach="E Unexpected Discovery", bucket="11-15s",
      hook="זה לא צעצוע.\nויש סיבה לידיים.",
      vo="זה לא צעצוע, וזה לא יצור מסרט אימה. | זה מכשיר עיסוי לצוואר ולכתפיים. | הידיים נועדו לדמות לישה, | ויש גם חימום. | RELUNAVI N7, | הקישור בפרופיל.", rate="+12%",
      shots=[CLOSE_MAIN, part(PROFILE, 3.4, 6.3), part(CLOSE_FD, 19.4, 22.4), part(BACK, 14.0, 16.0), RECLINE, CLOSE_END],
      hook_until=2.85, end=END, end_len=1.4),
 dict(id="RLN-N7-V06", product="N7", approach="D Storytelling (POV workday)", bucket="16-20s",
      hook="סוף יום עבודה.\nהכתפיים מבקשות הפסקה.",
      vo="שמונה שעות מול מסך. | נסיעה הביתה. | והכתפיים מרגישות את כל היום. | אז כמה דקות על הספה, | עיסוי לישה לצוואר ולכתפיים, | עם חימום נעים. | בלי לקבוע תור, ובלי לצאת מהבית. | RELUNAVI N7. | הקישור בפרופיל.", rate="+12%",
      shots=[part(BACK, 12.8, 16.2), part(CLOSE_MAIN, 0.0, 2.6), part(PROFILE, 3.4, 6.6), part(CLOSE_FD, 19.4, 22.6), RECLINE, part(BACK, 15.6, 18.6), RECLINE2, CLOSE_END],
      hook_until=3.3, end=END, end_len=1.4),
]
