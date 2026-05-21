'use client';
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem('ai_office_token', token);
      router.replace('/dashboard');
    } else {
      router.replace('/?error=auth_failed');
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center">
      <div className="text-center text-white">
        <div className="text-5xl mb-4 animate-spin">⟳</div>
        <p className="text-xl">מחבר את החשבון שלך...</p>
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-blue-900 flex items-center justify-center">
        <div className="text-white text-xl">טוען...</div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
