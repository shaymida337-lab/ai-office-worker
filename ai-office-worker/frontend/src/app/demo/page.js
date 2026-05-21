'use client';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api';
import Link from 'next/link';

function formatCurrency(value, currency = 'ILS') {
  if (value === null || value === undefined) return '-';
  return `${value.toLocaleString('he-IL')} ${currency}`;
}

export default function DemoPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiClient.getDemo()
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message || 'שגיאה'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">טוען...</div>;
  if (error) return <div className="p-8 text-red-500">שגיאה: {error}</div>;

  const { stats, payments, documents, alerts, tasks } = data;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Demo Live Dashboard</h1>
          <p className="text-gray-500 mt-2">נתונים אמתיים מתוך ה-DB המקומי.</p>
        </div>
        <Link href="/dashboard" className="text-blue-700 text-sm hover:underline">לוח בקרה רגיל</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <StatCard label="Money to pay" value={formatCurrency(stats.moneyToPay)} color="red" />
        <StatCard label="Money to receive" value={formatCurrency(stats.moneyToReceive)} color="blue" />
        <StatCard label="Open tasks" value={stats.openTasks} color="amber" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Panel title="Payments">
          {payments.length === 0 ? <div className="text-gray-500">אין תשלומים.</div> : (
            <ul className="space-y-2">
              {payments.map(p => (
                <li key={p.id} className="p-3 border rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold">{p.supplierName || 'לא ידוע'}</div>
                      <div className="text-xs text-gray-500">{p.invoiceLink ? <a href={p.invoiceLink} className="text-blue-600" target="_blank" rel="noreferrer">פתח חשבונית</a> : 'אין קישור'}</div>
                    </div>
                    <div className="text-sm text-gray-700">{p.paid ? 'שולם' : 'לא שולם'}</div>
                  </div>
                  <div className="mt-2 text-sm text-gray-600">{formatCurrency(p.amount, p.currency)} • תאריך לתשלום: {p.dueDate ? new Date(p.dueDate).toLocaleDateString('he-IL') : '-'}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Missing invoices">
          {stats.missingInvoices === 0 ? <div className="text-gray-500">אין חשבוניות חסרות.</div> : <div className="text-sm text-gray-700">{stats.missingInvoices} חשבוניות חסרות.</div>}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Panel title="Alerts">
          {alerts.length === 0 ? <div className="text-gray-500">אין התראות פעילה.</div> : (
            <ul className="space-y-2">
              {alerts.map(a => (
                <li key={a.id} className="p-3 border rounded-xl bg-yellow-50">
                  <div className="font-medium">{a.type}</div>
                  <div className="text-sm text-gray-700">{a.message}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Tasks">
          {tasks.length === 0 ? <div className="text-gray-500">אין משימות פתוחות.</div> : (
            <ul className="space-y-2">
              {tasks.map(task => (
                <li key={task.id} className="p-3 border rounded-xl">
                  <div className="font-semibold">{task.title}</div>
                  <div className="text-sm text-gray-600">{task.details || 'אין פרטים'}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent documents">
        {documents.length === 0 ? <div className="text-gray-500">אין מסמכים אחרונים.</div> : (
          <ul className="space-y-2">
            {documents.map(doc => (
              <li key={doc.id} className="p-3 border rounded-xl">
                <div className="font-semibold">{doc.vendorName || 'לא ידוע'} ({doc.docType})</div>
                <div className="text-sm text-gray-600">{doc.invoiceNumber || '-'} • {doc.totalAmount ? `${doc.totalAmount} ${doc.currency}` : '-'}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-white border rounded-3xl shadow-sm p-6">
      <h2 className="font-bold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 border-blue-100 text-blue-800',
    red: 'bg-red-50 border-red-100 text-red-800',
    amber: 'bg-amber-50 border-amber-100 text-amber-800',
  };
  return (
    <div className={`rounded-3xl border p-6 ${colors[color] || 'bg-gray-50 border-gray-100 text-gray-800'}`}>
      <div className="text-sm text-gray-500 mb-2">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}
