'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/constants';

const PRIORITY_EMOJI = { 1: '🔴', 2: '🟡', 3: '🟢' };

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const searchParams = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState({});
  const [showEdit, setShowEdit] = useState(false);

  const load = () =>
    apiClient.getClient(clientId)
      .then((res) => {
        setData(res.data);
        setEdit({
          name: res.data.client.name,
          email: res.data.client.email,
          invoiceSheetUrl: res.data.client.invoiceSheetUrl || '',
          taskSheetUrl: res.data.client.taskSheetUrl || '',
          driveFolderUrl: res.data.client.driveFolderUrl || '',
        });
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    if (searchParams.get('connected')) setMsg('✅ Gmail חובר בהצלחה');
    if (searchParams.get('edit')) setShowEdit(true);
  }, [clientId, searchParams]);

  const save = async () => {
    try {
      await apiClient.updateClient(clientId, edit);
      setShowEdit(false);
      setMsg('✅ נשמר');
      load();
    } catch (err) {
      setMsg(`❌ ${err.response?.data?.error || 'שגיאה'}`);
    }
  };

  const scan = async () => {
    try {
      await apiClient.scanClient(clientId);
      setMsg('🔄 סריקה הופעלה');
    } catch (err) {
      setMsg(`❌ ${err.response?.data?.error || 'שגיאה'}`);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">טוען...</div>;
  if (!data) return <div>לקוח לא נמצא</div>;

  const { client, documents, tasks } = data;

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/dashboard/clients" className="text-sm text-blue-700 hover:underline">← חזרה ללקוחות</Link>

      <div className="flex items-center justify-between mt-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 rounded-full" style={{ backgroundColor: client.color || '#3B82F6' }} />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{client.name}</h1>
            <p className="text-sm text-gray-500">{client.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={scan} className="bg-blue-900 text-white px-4 py-2 rounded-xl text-sm font-bold">סרוק</button>
          {client.invoiceSheetUrl && (
            <a href={client.invoiceSheetUrl} target="_blank" rel="noreferrer" className="bg-gray-100 px-4 py-2 rounded-xl text-sm">פתח Sheets</a>
          )}
          {client.driveFolderUrl && (
            <a href={client.driveFolderUrl} target="_blank" rel="noreferrer" className="bg-gray-100 px-4 py-2 rounded-xl text-sm">פתח Drive</a>
          )}
          <a href={apiClient.connectClientGmailUrl(clientId)} className="bg-green-50 text-green-800 px-4 py-2 rounded-xl text-sm">חבר Gmail</a>
          <button onClick={() => setShowEdit(true)} className="bg-gray-100 px-4 py-2 rounded-xl text-sm">הגדרות</button>
        </div>
      </div>

      {msg && <div className="bg-blue-50 text-blue-800 rounded-xl p-3 mb-4 text-sm">{msg}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-4 text-sm"><div className="text-gray-500">לשלם</div><div className="font-bold">{formatCurrency(client.stats?.toPay)}</div></div>
        <div className="card p-4 text-sm"><div className="text-gray-500">משימות</div><div className="font-bold">{client.stats?.openTasks ?? 0}</div></div>
        <div className="card p-4 text-sm"><div className="text-gray-500">חשבוניות</div><div className="font-bold">{client.stats?.invoices ?? 0}</div></div>
        <div className="card p-4 text-sm"><div className="text-gray-500">חסרות</div><div className="font-bold">{client.stats?.missingInvoices ?? 0}</div></div>
      </div>

      <div className="card mb-6">
        <div className="p-4 border-b font-bold">חשבוניות</div>
        <div className="divide-y">
          {documents.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">אין חשבוניות</div>
          ) : documents.map((doc) => (
            <div key={doc.id} className="p-4 flex justify-between items-center text-sm">
              <div>
                <div className="font-medium">{doc.vendorName || 'ספק'}</div>
                <div className="text-gray-400 text-xs">{formatDate(doc.receivedAt || doc.createdAt)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold">{formatCurrency(doc.totalAmount, doc.currency)}</span>
                {doc.driveFileUrl && (
                  <a href={doc.driveFileUrl} target="_blank" rel="noreferrer" className="text-blue-700">📎 Drive</a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="p-4 border-b font-bold">משימות</div>
        <div className="divide-y">
          {tasks.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">אין משימות פתוחות</div>
          ) : tasks.map((task) => (
            <div key={task.id} className="p-4 text-sm">
              <div className="font-medium">
                {PRIORITY_EMOJI[task.priority] || '🟡'} {task.title}
              </div>
              {task.details && <div className="text-gray-500 mt-1">{task.details}</div>}
              {task.dueDate && <div className="text-xs text-gray-400 mt-1">עד {formatDate(task.dueDate)}</div>}
            </div>
          ))}
        </div>
      </div>

      {showEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-lg space-y-3">
            <h2 className="font-bold">הגדרות לקוח</h2>
            {['name', 'email', 'invoiceSheetUrl', 'taskSheetUrl', 'driveFolderUrl'].map((field) => (
              <input
                key={field}
                className="w-full border rounded-xl px-3 py-2 text-sm"
                placeholder={field}
                value={edit[field] || ''}
                onChange={(e) => setEdit({ ...edit, [field]: e.target.value })}
              />
            ))}
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 bg-blue-900 text-white py-2 rounded-xl text-sm font-bold">שמור</button>
              <button onClick={() => setShowEdit(false)} className="flex-1 bg-gray-100 py-2 rounded-xl text-sm">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
