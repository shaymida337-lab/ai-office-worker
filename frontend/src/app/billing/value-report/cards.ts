export const REPORT_CARDS = [
  { key: "read", metricId: "documents" as const, label: "קראתי וסידרתי מסמכים", accent: "blue" as const, icon: "📄" },
  { key: "drive", metricId: "documents" as const, label: "שמרתי קבצים ב-Google Drive", accent: "indigo" as const, icon: "📂" },
  { key: "sheets", metricId: "tasks" as const, label: "עדכנתי נתונים ב-Google Sheets", accent: "violet" as const, icon: "📊" },
  { key: "payments", metricId: "payments" as const, label: "זיהיתי תשלומים", accent: "emerald" as const, icon: "💳" },
  { key: "answers", metricId: "hours" as const, label: "עניתי על שאלות על העסק", accent: "blue" as const, icon: "💬" },
  { key: "accountant", metricId: "tasks" as const, label: "הכנתי סדר לרואה החשבון", accent: "violet" as const, icon: "📋" },
] as const;
