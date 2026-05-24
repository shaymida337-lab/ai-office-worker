'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, DOC_TYPE_LABELS, formatCurrency, formatDate } from '@/lib/constants';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const [clientsData, setClientsData] = useState({ clients: [], totals: {} });

  useEffect(() => {
    Promise.all([apiClient.getStats(), apiClient.getMe(), apiClient.getClients()])
      .then(([statsRes, meRes, clientsRes]) => {
        setData(statsRes.data);
        setUser(meRes.data.user);
        setClientsData(clientsRes.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const scanAllClients = async () => {
    setScanning(true);
    setScanMsg('');
    try {
      await apiClient.scanAllClients();
      setScanMsg('סריקה הופעלה לכל הלקוחות!');
    } catch {
      setScanMsg('שגיאה בהפעלת הסריקה.');
    } finally {
      setScanning(false);
    }
  };

  const triggerScan = async () => {
    setScanning(true);
    setScanMsg('');
    try {
      await apiClient.triggerScan();
      setScanMsg('סריקה הופעלה! הנתונים יתעדכנו תוך כדקה.');
      setTimeout(() => {
        apiClient.getStats().then(r => setData(r.data));
        setScanMsg('');
      }, 60000);
    } catch {
      setScanMsg('שגיאה בהפעלת הסריקה.');
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg">טוען נתונים...</div>
      </div>
    );
  }

  const stats = data?.stats || {};
  const recentDocs = data?.recentDocs || [];
  const clients = clientsData.clients || [];
  const totals = clientsData.totals || {};
  const name = user?.displayName?.split(' ')[0] || 'שלום';
  const googleConnected = user?.googleConnected;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">לוח בקרה — כל הלקוחות</h1>
          <p className="text-gray-500 text-sm mt-1">שלום {name} 👋</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={scanAllClients}
            disabled={scanning}
            className="bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold"
          >
            {scanning ? 'סורק...' : 'סרוק את כולם'}
          </button>
          <Link href="/dashboard/clients" className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
            + הוסף לקוח
          </Link>
        </div>
      </div>

      {scanMsg && (
        <div className="bg-blue-50 text-blue-700 rounded-xl p-4 mb-6 text-sm">{scanMsg}</div>
      )}

      {clients.length > 0 ? (
        <>
          <div className="space-y-3 mb-6">
            {clients.map((c) => (
              <Link key={c.id} href={`/dashboard/clients/${c.id}`} className="card p-5 block hover:bg-gray-50">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: c.color || '#3B82F6' }} />
                  <span className="font-bold text-gray-800">{c.name}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-600">
                  <span>💰 לשלם: {formatCurrency(c.stats?.toPay)}</span>
                  <span>📋 משימות: {c.stats?.openTasks ?? 0}</span>
                  <span>📄 חשבוניות: {c.stats?.invoices ?? 0}</span>
                  <span>⚠️ חסרות: {c.stats?.missingInvoices ?? 0}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="card p-5 mb-6 text-sm">
            <div className="font-bold mb-2">סה״כ כל הלקוחות</div>
            <div className="flex flex-wrap gap-4 text-gray-700">
              <span>💰 {formatCurrency(totals.toPay)}</span>
              <span>📋 {totals.openTasks ?? 0} משימות</span>
              <span>📄 {totals.invoices ?? 0} חשבוניות</span>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-8 text-center mb-6">
          <p className="text-gray-500 mb-4">עדיין אין לקוחות. הוסף לקוח ראשון כדי להתחיל.</p>
          <Link href="/dashboard/clients" className="text-blue-700 font-bold hover:underline">ניהול לקוחות →</Link>
        </div>
      )}

      {!googleConnected && clients.length === 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
          ניתן גם לחבר Gmail אישי:{' '}
          <a href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/google`} className="font-bold underline">התחבר עם Google</a>
        </div>
      )}

      {/* Legacy personal scan */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-700">החשבון האישי שלי</h2>
        <button
          onClick={triggerScan}
          disabled={scanning || !googleConnected}
          className="text-sm bg-gray-100 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          סרוק Gmail אישי
        </button>
      </div>

      {/* Connected sheets */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3">טבלאות מחוברות</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{data?.sheets?.invoiceSheetUrl ? '✅ טבלת חשבוניות' : '⏳ טבלת חשבוניות (תיווצר אוטומטית)'}</span>
              {data?.sheets?.invoiceSheetUrl && (
                <a href={data.sheets.invoiceSheetUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline shrink-0">פתח ↗</a>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{data?.sheets?.taskSheetUrl ? '✅ טבלת משימות' : '⏳ טבלת משימות (תיווצר אוטומטית)'}</span>
              {data?.sheets?.taskSheetUrl && (
                <a href={data.sheets.taskSheetUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline shrink-0">פתח ↗</a>
              )}
            </div>
            <Link href="/dashboard/settings" className="inline-block mt-2 text-blue-700 text-sm font-medium hover:underline">הגדרות →</Link>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3">סריקה אחרונה</h2>
          {data?.lastScan ? (
            <div className="space-y-1 text-sm text-gray-600">
              <div>📬 {data.lastScan.scanned ?? 0} מיילים נסרקו</div>
              <div>🧾 {data.lastScan.saved ?? 0} חשבוניות → {data.lastScan.invoicesWritten ?? 0} נכתבו לטבלה</div>
              <div>✅ {data.lastScan.tasksCreated ?? 0} משימות → {data.lastScan.tasksWritten ?? 0} נכתבו לטבלה</div>
              {data.lastScan.at && (
                <div className="text-xs text-gray-400 mt-2">{new Date(data.lastScan.at).toLocaleString('he-IL')}</div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">עדיין לא בוצעה סריקה</p>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          emoji="📄"
          label="מסמכים חדשים"
          value={stats.newDocs ?? 0}
          color="blue"
        />
        <StatCard
          emoji="💰"
          label="סה״כ לתשלום"
          value={formatCurrency(stats.totalDue)}
          color="indigo"
          small
        />
        <StatCard
          emoji="📉"
          label="לחיוב (לתשלום)"
          value={formatCurrency(stats.moneyToPay)}
          color="red"
          small
        />
        <StatCard
          emoji="📈"
          label="לחיוב (מקבל)"
          value={formatCurrency(stats.moneyToReceive)}
          color="blue"
          small
        />
        <StatCard
          emoji="📅"
          label="תשלומים השבוע"
          value={stats.upcomingPayments ?? 0}
          color="amber"
        />
        <StatCard
          emoji="⚠️"
          label="דורשים בדיקה"
          value={stats.needsReview ?? 0}
          color="red"
        />
      </div>

      {/* Overdue alert */}
      {(stats.overduePayments ?? 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <span className="text-2xl">🚨</span>
          <div>
            <div className="font-bold text-red-800">יש {stats.overduePayments} מסמכים באיחור!</div>
            <div className="text-red-600 text-sm">בדוק את המסמכים ועדכן את הסטטוס שלהם.</div>
          </div>
          <Link href="/dashboard/documents?status=OVERDUE" className="mr-auto bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-700 transition-colors">
            צפה
          </Link>
        </div>
      )}

      {/* Alerts */}
      {data?.alerts && data.alerts.length > 0 && (
        <div className="mb-6">
          {data.alerts.map(a => (
            <div key={a.id} className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-md mb-2">
              <div className="font-medium text-sm">{a.type}</div>
              <div className="text-xs text-gray-700">{a.message}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recent documents */}
      <div className="card">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">מסמכים אחרונים</h2>
          <div className="flex items-center gap-4">
            <Link href="/dashboard/documents" className="text-blue-700 text-sm hover:underline">כל המסמכים →</Link>
            <Link href="/dashboard/payments" className="text-blue-700 text-sm hover:underline">תשלומים</Link>
            <Link href="/dashboard/missing-invoices" className="text-blue-700 text-sm hover:underline">חשבוניות חסרות</Link>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {recentDocs.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <div className="text-4xl mb-2">📭</div>
              <p>עדיין אין מסמכים. לחץ "סרוק עכשיו" להתחיל.</p>
            </div>
          ) : recentDocs.map(doc => (
            <Link
              key={doc.id}
              href={`/dashboard/documents/${doc.id}`}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getDocIcon(doc.docType)}</span>
                <div>
                  <div className="font-medium text-gray-800 text-sm">
                    {doc.vendorName || 'ספק לא ידוע'}
                  </div>
                  <div className="text-gray-400 text-xs">{formatDate(doc.createdAt)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {doc.totalAmount && (
                  <span className="font-bold text-gray-700 text-sm">
                    {formatCurrency(doc.totalAmount, doc.currency)}
                  </span>
                )}
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[doc.status] || doc.status}
                </span>
                {doc.requiresAction && (
                  <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">דורש פעולה</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ emoji, label, value, color, small }) {
  const colors = {
    blue: 'bg-blue-50 border-blue-100',
    indigo: 'bg-indigo-50 border-indigo-100',
    amber: 'bg-amber-50 border-amber-100',
    red: 'bg-red-50 border-red-100',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] || 'bg-gray-50 border-gray-100'}`}>
      <div className="text-2xl mb-2">{emoji}</div>
      <div className={`font-bold text-gray-800 ${small ? 'text-lg' : 'text-3xl'}`}>{value}</div>
      <div className="text-gray-500 text-xs mt-1">{label}</div>
    </div>
  );
}

function getDocIcon(docType) {
  const icons = { INVOICE: '🧾', RECEIPT: '✅', PAYMENT_REQUEST: '📋', QUOTE: '💬', OTHER: '📄' };
  return icons[docType] || '📄';
}
