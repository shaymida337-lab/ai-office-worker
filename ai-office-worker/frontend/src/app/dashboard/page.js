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

  useEffect(() => {
    Promise.all([apiClient.getStats(), apiClient.getMe()])
      .then(([statsRes, meRes]) => {
        setData(statsRes.data);
        setUser(meRes.data.user);
      })
      .finally(() => setLoading(false));
  }, []);

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
  const name = user?.displayName?.split(' ')[0] || 'שלום';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">שלום {name} 👋</h1>
          <p className="text-gray-500 text-sm mt-1">
            {new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={triggerScan}
          disabled={scanning}
          className="bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
        >
          <span className={scanning ? 'animate-spin' : ''}>🔄</span>
          {scanning ? 'סורק...' : 'סרוק עכשיו'}
        </button>
      </div>

      {scanMsg && (
        <div className="bg-blue-50 text-blue-700 rounded-xl p-4 mb-6 text-sm">{scanMsg}</div>
      )}

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
