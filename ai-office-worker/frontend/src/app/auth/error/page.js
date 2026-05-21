'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const msg = searchParams.get('msg') || 'unknown_error';
  const reason = searchParams.get('reason');

  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 text-center max-w-sm mx-4">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">שגיאה בהתחברות</h1>
        <p className="text-gray-500 text-sm mb-4">קוד שגיאה: {msg}</p>
        {reason && (
          <div className="bg-gray-100 text-gray-800 text-xs rounded-lg p-3 mb-4 text-left break-words">
            פרטי שגיאה: {reason}
          </div>
        )}
        <Link href="/" className="bg-blue-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-800 transition-colors">
          נסה שוב
        </Link>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-blue-900"/>}>
      <AuthErrorContent />
    </Suspense>
  );
}
