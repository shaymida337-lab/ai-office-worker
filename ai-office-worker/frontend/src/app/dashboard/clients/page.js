'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { formatCurrency } from '@/lib/constants';

const STATUS = (c) => ({
  gmail: c.gmailConnected ? '✅' : '❌',
  sheets: c.invoiceSheetUrl ? '✅' : '❌',
  drive: c.driveFolderUrl ? '✅' : '❌',
});

export default function ClientsPage() {
  const [data, setData] = useState({ clients: [], totals: {} });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', invoiceSheetUrl: '', taskSheetUrl: '', driveFolderUrl: '',
  });
  const [msg, setMsg] = useState('');
  const searchParams = useSearchParams();

  const load = () =>
    apiClient.getClients()
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const err = searchParams.get('error');
    const connected = searchParams.get('connected');
    if (err) setMsg('❌ שגיאה בחיבור Gmail');
    if (connected) setMsg('✅ Gmail חובר בהצלחה');
  }, [searchParams]);

  const createClient = async (e) => {
    e.preventDefault();
    try {
      await apiClient.createClient(form);
      setShowForm(false);
      setForm({ name: '', email: '', invoiceSheetUrl: '', taskSheetUrl: '', driveFolderUrl: '' });
      setMsg('✅ לקוח נוסף');
      load();
    } catch (err) {
      setMsg(`❌ ${err.response?.data?.error || 'שגיאה'}`);
    }
  };

  const scanAll = async () => {
    try {
      await apiClient.scanAllClients();
      setMsg('🔄 סריקה הופעלה לכל הלקוחות');
    } catch {
      setMsg('❌ שגיאה בסריקה');
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">טוען...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">ניהול לקוחות</h1>
        <div className="flex gap-2">
          <button onClick={scanAll} className="bg-blue-900 text-white px-4 py-2 rounded-xl text-sm font-bold">סרוק את כולם</button>
          <button onClick={() => setShowForm(true)} className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-bold">+ הוסף לקוח</button>
        </div>
      </div>

      {msg && <div className="bg-blue-50 text-blue-800 rounded-xl p-3 mb-4 text-sm">{msg}</div>}

      <div className="space-y-3">
        {data.clients.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">אין לקוחות עדיין. הוסף לקוח ראשון.</div>
        ) : data.clients.map((c) => {
          const st = STATUS(c);
          return (
            <div key={c.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: c.color || '#3B82F6' }} />
                  <div>
                    <div className="font-bold text-gray-800">{c.name}</div>
                    <div className="text-sm text-gray-500">{c.email}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      Gmail {st.gmail} · Sheets {st.sheets} · Drive {st.drive}
                    </div>
                  </div>
                </div>
                <div className="text-left text-sm">
                  <div>💰 {formatCurrency(c.stats?.toPay)}</div>
                  <div>📋 {c.stats?.openTasks ?? 0} משימות</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Link href={`/dashboard/clients/${c.id}`} className="text-sm bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200">דוח</Link>
                <Link href={`/dashboard/clients/${c.id}?edit=1`} className="text-sm bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200">הגדרות</Link>
                <button
                  type="button"
                  onClick={() => apiClient.scanClient(c.id).then(() => setMsg(`🔄 סריקה הופעלה: ${c.name}`))}
                  className="text-sm bg-blue-50 text-blue-800 px-3 py-1.5 rounded-lg"
                >
                  סרוק
                </button>
                <a
                  href={apiClient.connectClientGmailUrl(c.id)}
                  className="text-sm bg-green-50 text-green-800 px-3 py-1.5 rounded-lg"
                >
                  חבר Gmail
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={createClient} className="card p-6 w-full max-w-lg space-y-3">
            <h2 className="font-bold text-lg mb-2">לקוח חדש</h2>
            <input required placeholder="שם העסק" className="w-full border rounded-xl px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input required type="email" placeholder="Gmail של הלקוח" className="w-full border rounded-xl px-3 py-2 text-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="URL טבלת חשבוניות" className="w-full border rounded-xl px-3 py-2 text-sm" value={form.invoiceSheetUrl} onChange={(e) => setForm({ ...form, invoiceSheetUrl: e.target.value })} />
            <input placeholder="URL טבלת משימות" className="w-full border rounded-xl px-3 py-2 text-sm" value={form.taskSheetUrl} onChange={(e) => setForm({ ...form, taskSheetUrl: e.target.value })} />
            <input placeholder="URL תיקיית Drive" className="w-full border rounded-xl px-3 py-2 text-sm" value={form.driveFolderUrl} onChange={(e) => setForm({ ...form, driveFolderUrl: e.target.value })} />
            <div className="flex gap-2 pt-2">
              <button type="submit" className="flex-1 bg-blue-900 text-white py-2 rounded-xl text-sm font-bold">שמור</button>
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-100 py-2 rounded-xl text-sm">ביטול</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
