'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatDate } from '@/lib/constants';

export default function MissingInvoicesPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.getMissingInvoices().then(r => setDocs(r.data.docs || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-gray-500">טוען...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">חשבוניות חסרות</h1>
        <Link href="/dashboard" className="text-sm text-blue-600">חזור ללוח הבקרה</Link>
      </div>

      <div className="card">
        <div className="p-4">
          {docs.length === 0 ? (
            <div className="text-gray-500">אין מסמכים חסרים.</div>
          ) : (
            <ul className="space-y-2">
              {docs.map(d => (
                <li key={d.id} className="flex items-center justify-between p-2 border-b">
                  <div>
                    <div className="font-medium">{d.vendorName || 'לא ידוע'}</div>
                    <div className="text-xs text-gray-500">{d.invoiceNumber || '-'} • {d.totalAmount ? d.totalAmount.toLocaleString('he-IL') : '-'}</div>
                  </div>
                  <div className="text-xs text-gray-500">{d.paymentDueDate ? formatDate(d.paymentDueDate) : '-'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
