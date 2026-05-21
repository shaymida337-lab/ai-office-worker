export const STATUS_LABELS = {
  NEW: 'חדש',
  PAID: 'שולם',
  OVERDUE: 'באיחור',
  NEEDS_REVIEW: 'דורש בדיקה',
  MISSING_INVOICE: 'חסרה חשבונית',
};

export const DOC_TYPE_LABELS = {
  INVOICE: 'חשבונית',
  RECEIPT: 'קבלה',
  PAYMENT_REQUEST: 'דרישת תשלום',
  QUOTE: 'הצעת מחיר',
  OTHER: 'אחר',
};

export const STATUS_COLORS = {
  NEW: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800',
  MISSING_INVOICE: 'bg-gray-100 text-gray-600',
};

export const formatCurrency = (amount, currency = 'ILS') => {
  if (!amount && amount !== 0) return '-';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: currency || 'ILS',
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'numeric', year: 'numeric',
  });
};
