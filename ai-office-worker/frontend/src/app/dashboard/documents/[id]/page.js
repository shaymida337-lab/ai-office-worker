'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { STATUS_LABELS, STATUS_COLORS, DOC_TYPE_LABELS, formatCurrency, formatDate } from '@/lib/constants';

const ALL_STATUSES = ['NEW', 'PAID', 'OVERDUE', 'NEEDS_REVIEW', 'MISSING_INVOICE'];

export default function DocumentDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiClient.getDocument(id)
      .then(r => setDoc(r.data))
      .catch(() => router.replace('/dashboard/documents'))
      .finally(() => setLoading(false));
  }, [id, router]);

  const updateStatus = async (newStatus) => {
    setSaving(true);
    try {
      const { data } = await apiClient.updateDocumentStatus(id, newStatus);
      setDoc(data);
      setMsg('סטטוס עודכן בהצלחה');
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('שגיאה בעדכון');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">טוען...</div>;
  if (!doc) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/documents" className="text-gray-400 hover:text-gray-600">← חזור</Link>
        <h1 className="text-xl font-bold text-gray-800">{doc.vendorName || 'מסמך לא מזוהה'}</h1>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>
          {STATUS_LABELS[doc.status]}
        </span>
      </div>

      {msg && (
        <div className="bg-green-50 text-green-700 rounded-xl p-3 mb-5 text-sm">{msg}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Main info */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-700 mb-4 pb-2 border-b border-gray-100">פרטי מסמך</h2>
          <dl className="space-y-3">
            <Row label="ספק" value={doc.vendorName} />
            <Row label="סוג מסמך" value={DOC_TYPE_LABELS[doc.docType]} />
            <Row label="מספר חשבונית" value={doc.invoiceNumber} />
            <Row label="תאריך מסמך" value={formatDate(doc.docDate)} />
            <Row label="תאריך לתשלום" value={formatDate(doc.paymentDueDate)} highlight={doc.status === 'OVERDUE'} />
            <Row label="סכום לפני מע״מ" value={formatCurrency(doc.amountPreTax, doc.currency)} />
            <Row label="מע״מ" value={formatCurrency(doc.taxAmount, doc.currency)} />
            <Row label="סכום כולל" value={formatCurrency(doc.totalAmount, doc.currency)} bold />
            <Row label="מטבע" value={doc.currency} />
          </dl>
        </div>

        {/* Email + AI info */}
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="font-bold text-gray-700 mb-4 pb-2 border-b border-gray-100">פרטי מייל</h2>
            <dl className="space-y-3">
              <Row label="שולח" value={doc.emailSender} />
              <Row label="כתובת" value={doc.emailSenderAddr} small />
              <Row label="נושא" value={doc.emailSubject} />
              <Row label="התקבל" value={formatDate(doc.receivedAt)} />
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="font-bold text-gray-700 mb-4 pb-2 border-b border-gray-100">ניתוח בינה מלאכותית</h2>
            <dl className="space-y-3">
              <Row label="רמת ביטחון" value={doc.aiConfidence ? `${Math.round(doc.aiConfidence * 100)}%` : '-'} />
              <Row label="הערות המערכת" value={doc.aiNotes} />
              <Row label="דורש פעולה" value={doc.requiresAction ? '✅ כן' : 'לא'} />
            </dl>

            {doc.driveFileUrl && (
              <a
                href={doc.driveFileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center gap-2 text-blue-700 hover:underline text-sm"
              >
                ☁️ פתח קובץ בענן
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Status update */}
      <div className="card p-5 mt-5">
        <h2 className="font-bold text-gray-700 mb-4">עדכון סטטוס</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => updateStatus(s)}
              disabled={saving || doc.status === s}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                doc.status === s
                  ? STATUS_COLORS[s] + ' ring-2 ring-offset-1 ring-current'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, small, highlight }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500 text-sm shrink-0">{label}</dt>
      <dd className={`text-sm text-left ${bold ? 'font-bold text-gray-900' : 'text-gray-700'} ${small ? 'text-xs' : ''} ${highlight ? 'text-red-600 font-bold' : ''}`}>
        {value || '-'}
      </dd>
    </div>
  );
}
