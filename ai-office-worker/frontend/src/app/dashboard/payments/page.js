'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/constants';

export default function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  const loadData = async () => {
    const params = filter === 'paid' ? { paid: 'true' } : filter === 'unpaid' ? { paid: 'false' } : {};
    const [paymentsRes, suppliersRes] = await Promise.all([
      apiClient.getPayments(params),
      apiClient.getSuppliers(),
    ]);
    setPayments(paymentsRes.data.payments || []);
    setSuppliers(suppliersRes.data.suppliers || []);
  };

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [filter]);

  const togglePaid = async (payment) => {
    setUpdatingId(payment.id);
    try {
      await apiClient.markPaymentPaid(payment.id, !payment.paid);
      await loadData();
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) return <div className="p-8 text-gray-500">טוען...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">תשלומים לספקים</h1>
        <Link href="/dashboard" className="text-sm text-blue-600">חזור ללוח הבקרה</Link>
      </div>

      {suppliers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {suppliers.slice(0, 6).map(s => (
            <div key={s.name} className="card p-4">
              <div className="font-bold text-gray-800">{s.name}</div>
              <div className="text-sm text-gray-500 mt-1">{s.count} חשבוניות</div>
              <div className="text-red-600 font-bold mt-2">{formatCurrency(s.unpaid)} לתשלום</div>
              <div className="text-green-600 text-sm">{formatCurrency(s.paid)} שולם</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {[
          { key: 'all', label: 'הכל' },
          { key: 'unpaid', label: 'לא שולם' },
          { key: 'paid', label: 'שולם' },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${filter === opt.key ? 'bg-blue-900 text-white' : 'bg-white border text-gray-600'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-right">
          <thead>
            <tr className="text-xs text-gray-500 border-b">
              <th className="p-2">ספק</th>
              <th className="p-2">סכום</th>
              <th className="p-2">תאריך</th>
              <th className="p-2">תאריך לתשלום</th>
              <th className="p-2">סטטוס</th>
              <th className="p-2">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  אין תשלומים עדיין. התחבר עם Google וסרוק מיילים.
                </td>
              </tr>
            ) : payments.map(p => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{p.supplierName || 'לא ידוע'}</td>
                <td className="p-2">{formatCurrency(p.amount, p.currency)}</td>
                <td className="p-2">{p.date ? formatDate(p.date) : '-'}</td>
                <td className="p-2">{p.dueDate ? formatDate(p.dueDate) : '-'}</td>
                <td className="p-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${p.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {p.paid ? 'שולם' : 'לא שולם'}
                  </span>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => togglePaid(p)}
                      disabled={updatingId === p.id}
                      className="text-xs bg-blue-900 text-white px-3 py-1 rounded-lg disabled:opacity-50"
                    >
                      {updatingId === p.id ? '...' : p.paid ? 'בטל תשלום' : 'סמן כשולם'}
                    </button>
                    {p.documentId && (
                      <Link href={`/dashboard/documents/${p.documentId}`} className="text-xs text-blue-600 hover:underline">מסמך</Link>
                    )}
                    {p.invoiceLink && (
                      <a href={p.invoiceLink} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Drive</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
