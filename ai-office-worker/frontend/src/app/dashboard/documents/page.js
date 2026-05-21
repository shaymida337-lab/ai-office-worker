'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { apiClient } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, DOC_TYPE_LABELS, formatCurrency, formatDate } from '@/lib/constants';

const ALL_STATUSES = ['NEW', 'PAID', 'OVERDUE', 'NEEDS_REVIEW', 'MISSING_INVOICE'];

function DocumentsContent() {
  const searchParams = useSearchParams();
  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [page, setPage] = useState(1);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      if (search) params.search = search;

      const { data } = await apiClient.getDocuments(params);
      setDocs(data.documents);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">מסמכים</h1>
        <span className="text-gray-500 text-sm">{total} מסמכים סה"כ</span>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="🔍 חיפוש לפי ספק, נושא, מספר חשבונית..."
          className="flex-1 min-w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">כל הסטטוסים</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['ספק', 'סוג', 'מספר חשבונית', 'סכום', 'תאריך לתשלום', 'סטטוס', 'פעולה'].map(h => (
                  <th key={h} className="text-right px-4 py-3 text-gray-600 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">טוען...</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                  <div className="text-3xl mb-2">📭</div>
                  לא נמצאו מסמכים
                </td></tr>
              ) : docs.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{doc.vendorName || '-'}</div>
                    <div className="text-gray-400 text-xs">{formatDate(doc.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{DOC_TYPE_LABELS[doc.docType] || '-'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{doc.invoiceNumber || '-'}</td>
                  <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">
                    {formatCurrency(doc.totalAmount, doc.currency)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {formatDate(doc.paymentDueDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[doc.status] || doc.status}
                    </span>
                    {doc.requiresAction && (
                      <span className="mr-1 text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded-full">!</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/documents/${doc.id}`}
                      className="text-blue-700 hover:underline text-xs font-medium">
                      פרטים →
                    </Link>
                    {doc.driveFileUrl && (
                      <a href={doc.driveFileUrl} target="_blank" rel="noreferrer"
                        className="mr-3 text-gray-400 hover:text-gray-600 text-xs">
                        ☁️ קובץ
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="text-sm text-blue-700 disabled:text-gray-300 hover:underline">
              → הקודם
            </button>
            <span className="text-sm text-gray-500">עמוד {page} מתוך {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="text-sm text-blue-700 disabled:text-gray-300 hover:underline">
              ← הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-400">טוען...</div>}>
      <DocumentsContent />
    </Suspense>
  );
}
