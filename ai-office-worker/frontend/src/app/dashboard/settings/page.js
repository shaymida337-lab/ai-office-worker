'use client';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';

export default function SettingsPage() {
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiClient.getMe(), apiClient.getLogs()])
      .then(([meRes, logsRes]) => {
        setUser(meRes.data.user);
        setLogs(logsRes.data.logs);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">טוען...</div>;

  const LEVEL_COLORS = {
    INFO: 'bg-blue-100 text-blue-700',
    WARN: 'bg-amber-100 text-amber-700',
    ERROR: 'bg-red-100 text-red-700',
  };

  const LEVEL_LABELS = {
    INFO: 'מידע',
    WARN: 'אזהרה',
    ERROR: 'שגיאה',
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">הגדרות</h1>

      {/* Account info */}
      <div className="card p-6 mb-5">
        <h2 className="font-bold text-gray-700 mb-4">פרטי חשבון</h2>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">שם</span>
            <span className="text-sm font-medium">{user?.displayName || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">אימייל</span>
            <span className="text-sm">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">טבלת הנתונים</span>
            {user?.sheetsId ? (
              <a
                href={`https://docs.google.com/spreadsheets/d/${user.sheetsId}`}
                target="_blank" rel="noreferrer"
                className="text-sm text-blue-700 hover:underline"
              >
                פתח טבלה ↗
              </a>
            ) : (
              <span className="text-sm text-gray-400">ייווצר בסריקה הראשונה</span>
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">תיקיית הקבצים</span>
            <span className="text-sm text-gray-500">{user?.driveFolder ? '✅ מחוברת' : 'ייווצר בסריקה הראשונה'}</span>
          </div>
        </div>
      </div>

      {/* What the system does */}
      <div className="card p-6 mb-5">
        <h2 className="font-bold text-gray-700 mb-4">מה המערכת עושה אוטומטית</h2>
        <div className="space-y-2">
          {[
            '🔍 סורקת מיילים כל שעתיים לחשבוניות ומסמכים כספיים',
            '☁️ שומרת קבצים מצורפים בתיקיית הענן שלך',
            '📊 מכניסה שורה חדשה לטבלת הנתונים לכל מסמך',
            '🤖 מחלצת נתונים עם בינה מלאכותית: ספק, סכום, תאריך תשלום ועוד',
            '☀️ שולחת סיכום יומי למייל בכל יום בשעה 08:00',
            '🔒 לא מוחקת שום מייל או קובץ, לעולם',
          ].map(item => (
            <div key={item} className="text-sm text-gray-600 flex gap-2">
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity log */}
      <div className="card overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-bold text-gray-700">לוג פעילות אחרונה</h2>
        </div>
        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">אין פעילות עדיין</div>
          ) : logs.map(log => (
            <div key={log.id} className="px-5 py-3 flex items-start gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 shrink-0 ${LEVEL_COLORS[log.level] || 'bg-gray-100 text-gray-600'}`}>
                {LEVEL_LABELS[log.level] || log.level}
              </span>
              <div>
                <div className="text-sm text-gray-700">{log.message}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(log.createdAt).toLocaleString('he-IL')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
