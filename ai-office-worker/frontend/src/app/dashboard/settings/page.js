'use client';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';

export default function SettingsPage() {
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoiceSheetUrl, setInvoiceSheetUrl] = useState('');
  const [taskSheetUrl, setTaskSheetUrl] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [testing, setTesting] = useState({ invoice: false, task: false, drive: false });
  const [messages, setMessages] = useState({});

  const load = () =>
    Promise.all([apiClient.getSettings(), apiClient.getLogs()])
      .then(([settingsRes, logsRes]) => {
        const u = settingsRes.data.user;
        setUser(u);
        setInvoiceSheetUrl(u.invoiceSheetUrl || (u.invoiceSheetId ? `https://docs.google.com/spreadsheets/d/${u.invoiceSheetId}/edit` : '') || (u.sheetsId ? `https://docs.google.com/spreadsheets/d/${u.sheetsId}/edit` : ''));
        setTaskSheetUrl(u.taskSheetUrl || (u.taskSheetId ? `https://docs.google.com/spreadsheets/d/${u.taskSheetId}/edit` : ''));
        setDriveFolderUrl(u.driveFolderUrl || (u.driveFolder ? `https://drive.google.com/drive/folders/${u.driveFolder}` : ''));
        setLogs(logsRes.data.logs);
      })
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const testConnection = async (type) => {
    setTesting((t) => ({ ...t, [type]: true }));
    setMessages((m) => ({ ...m, [type]: '' }));
    try {
      if (type === 'drive') {
        await apiClient.testDriveFolder(driveFolderUrl);
        setMessages((m) => ({ ...m, drive: '✅ תיקיית Drive נשמרה בהצלחה' }));
      } else {
        const url = type === 'invoice' ? invoiceSheetUrl : taskSheetUrl;
        await apiClient.testSheetConnection(url, type);
        setMessages((m) => ({ ...m, [type]: '✅ החיבור לטבלה הצליח' }));
      }
      await load();
    } catch (err) {
      setMessages((m) => ({ ...m, [type]: `❌ ${err.response?.data?.error || 'שגיאה'}` }));
    } finally {
      setTesting((t) => ({ ...t, [type]: false }));
    }
  };

  const saveAll = async () => {
    try {
      await apiClient.saveSheetSettings({ invoiceSheetUrl, taskSheetUrl, driveFolderUrl });
      setMessages((m) => ({ ...m, save: '✅ ההגדרות נשמרו' }));
      await load();
    } catch (err) {
      setMessages((m) => ({ ...m, save: `❌ ${err.response?.data?.error || 'שגיאה'}` }));
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">טוען...</div>;

  const LEVEL_COLORS = {
    INFO: 'bg-blue-100 text-blue-700',
    WARN: 'bg-amber-100 text-amber-700',
    ERROR: 'bg-red-100 text-red-700',
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">הגדרות</h1>

      <div className="card p-6 mb-5">
        <h2 className="font-bold text-gray-700 mb-4">פרטי חשבון</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">שם</span><span>{user?.displayName || '-'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">אימייל</span><span>{user?.email}</span></div>
          <div className="flex justify-between">
            <span className="text-gray-500">Google</span>
            <span>{user?.googleConnected ? '✅ מחובר' : '❌ לא מחובר'}</span>
          </div>
        </div>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-bold text-gray-700 mb-2">חבר את הטבלאות שלך</h2>
        <p className="text-sm text-gray-500 mb-5">הדבק קישורים ל-Google Sheets ו-Drive שלך. אם לא מוגדר — המערכת תיצור טבלאות אוטומטית בסריקה הראשונה.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">טבלת חשבוניות</label>
            <input
              type="url"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm"
              placeholder="https://docs.google.com/spreadsheets/d/SHEET_ID/edit"
              value={invoiceSheetUrl}
              onChange={(e) => setInvoiceSheetUrl(e.target.value)}
            />
            <button
              type="button"
              onClick={() => testConnection('invoice')}
              disabled={testing.invoice || !invoiceSheetUrl}
              className="mt-2 text-sm bg-blue-900 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {testing.invoice ? 'בודק...' : 'בדוק חיבור'}
            </button>
            {messages.invoice && <p className="text-sm mt-2">{messages.invoice}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">טבלת משימות</label>
            <input
              type="url"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm"
              placeholder="https://docs.google.com/spreadsheets/d/SHEET_ID/edit"
              value={taskSheetUrl}
              onChange={(e) => setTaskSheetUrl(e.target.value)}
            />
            <button
              type="button"
              onClick={() => testConnection('task')}
              disabled={testing.task || !taskSheetUrl}
              className="mt-2 text-sm bg-blue-900 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {testing.task ? 'בודק...' : 'בדוק חיבור'}
            </button>
            {messages.task && <p className="text-sm mt-2">{messages.task}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תיקיית Drive לחשבוניות</label>
            <input
              type="url"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm"
              placeholder="https://drive.google.com/drive/folders/FOLDER_ID"
              value={driveFolderUrl}
              onChange={(e) => setDriveFolderUrl(e.target.value)}
            />
            <button
              type="button"
              onClick={() => testConnection('drive')}
              disabled={testing.drive || !driveFolderUrl}
              className="mt-2 text-sm bg-blue-900 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {testing.drive ? 'שומר...' : 'שמור תיקייה'}
            </button>
            {messages.drive && <p className="text-sm mt-2">{messages.drive}</p>}
          </div>

          <button type="button" onClick={saveAll} className="w-full bg-gray-800 text-white py-2.5 rounded-xl text-sm font-bold">
            שמור את כל ההגדרות
          </button>
          {messages.save && <p className="text-sm text-center">{messages.save}</p>}
        </div>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-bold text-gray-700 mb-4">מה המערכת עושה אוטומטית</h2>
        <div className="space-y-2 text-sm text-gray-600">
          {[
            '🔍 סורקת מיילים לחשבוניות ומשימות',
            '☁️ שומרת קבצים ב-Google Drive',
            '📊 כותבת חשבוניות לטבלת "חשבוניות"',
            '✅ כותבת משימות ממיילים לטבלת "משימות"',
            '🤖 מנתחת מיילים עם AI',
          ].map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-bold text-gray-700">לוג פעילות אחרונה</h2>
        </div>
        <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">אין פעילות עדיין</div>
          ) : logs.map((log) => (
            <div key={log.id} className="px-5 py-3 flex items-start gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 shrink-0 ${LEVEL_COLORS[log.level] || 'bg-gray-100 text-gray-600'}`}>
                {log.level}
              </span>
              <div>
                <div className="text-sm text-gray-700">{log.message}</div>
                <div className="text-xs text-gray-400 mt-0.5">{new Date(log.createdAt).toLocaleString('he-IL')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
