'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/constants';

export default function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.getPayments().then(r => { setPayments(r.data.payments || []); }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">טוען...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">תשלומים</h1>
        <Link href="/dashboard" className="text-sm text-blue-600">חזור ללוח הבקרה</Link>
      </div>

      <div className="card">
        <table className="w-full text-right">
          <thead>
            <tr className="text-xs text-gray-500 border-b">
              <th className="p-2">ספק</th>
              <th className="p-2">סכום</th>
              <th className="p-2">תאריך</th>
              <th className="p-2">תאריך לתשלום</th>
              <th className="p-2">סטטוס</th>
              <th className="p-2">מסמך</th>
              <th className="p-2">קישור לחשבונית</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-b hover:bg-gray-50">
                <td className="p-2">{p.supplierName || 'לא ידוע'}</td>
                <td className="p-2">{formatCurrency(p.amount, p.currency)}</td>
                <td className="p-2">{p.date ? formatDate(p.date) : '-'}</td>
                <td className="p-2">{p.dueDate ? formatDate(p.dueDate) : '-'}</td>
                <td className="p-2">{p.paid ? 'שולם' : 'לא שולם'}</td>
                <td className="p-2">
                  {p.documentId ? (
                    <Link href={`/dashboard/documents/${p.documentId}`} className="text-blue-600 hover:underline">עיין</Link>
                  ) : '-'}
                </td>
                <td className="p-2">
                  {p.invoiceLink ? (
                    <a href={p.invoiceLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">פתח</a>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
