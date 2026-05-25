import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

const HELP_SYSTEM_PROMPT = `אתה עוזר תמיכה של AI Office Worker.
המערכת עוזרת לעסקים לנהל לקוחות, חשבוניות, Gmail, Drive ו-Sheets אוטומטית.
ענה בעברית, קצר וברור, מקסימום 5 שורות.
תמיד ענה בצורה מועילה ומעשית.
אם לא יודע → "לא מצאתי תשובה, שלח לנו WhatsApp"`;

export async function answerHelpQuestion(question: string) {
  const cleanQuestion = question.trim().slice(0, 1000);
  if (!cleanQuestion) return "כתוב בקצרה מה לא עובד, ואנסה לעזור צעד אחר צעד.";

  if (!anthropic) return fallbackHelpAnswer(cleanQuestion);

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 350,
      system: HELP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: cleanQuestion }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    return text || fallbackHelpAnswer(cleanQuestion);
  } catch (err) {
    console.error("[help-ai] Claude failed", err);
    return fallbackHelpAnswer(cleanQuestion);
  }
}

function fallbackHelpAnswer(question: string) {
  if (/gmail|מייל|סריק/i.test(question)) {
    return 'בדוק ש-Gmail מחובר, רענן את הדף, ואז לחץ "סרוק Gmail". אם זה עדיין לא עובד, נתק וחבר מחדש את Google.';
  }
  if (/לקוח|לקוחות/i.test(question)) {
    return 'כנס ל"לקוחות", לחץ "+ הוסף לקוח", מלא שם ומייל ושמור. לאחר מכן אפשר לחבר Gmail ולסרוק נתונים.';
  }
  if (/חשבונית|תשלום|invoice/i.test(question)) {
    return 'לחץ "סרוק Gmail" שוב ובדוק שהחשבונית נמצאת במייל ולא ב-Spam. אם לא זוהתה, הוסף אותה ידנית דרך העלאת חשבונית.';
  }
  if (/drive|sheets|גיליון|קובץ/i.test(question)) {
    return "בדוק שהרשאות Google Drive ו-Sheets אושרו בחיבור Google. אם הקבצים לא נשמרים, חבר את Google מחדש.";
  }
  return "נסה לבחור נושא מתוך מרכז העזרה או לנסח את הבעיה במשפט קצר. לא מצאתי תשובה, שלח לנו WhatsApp.";
}
