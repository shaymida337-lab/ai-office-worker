'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api';

export default function DashboardLayout({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUser = useCallback(async () => {
    try {
      const { data } = await apiClient.getMe();
      setUser(data.user);
    } catch {
      router.replace('/');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleLogout = async () => {
    await apiClient.logout().catch(() => {});
    localStorage.removeItem('ai_office_token');
    router.replace('/');
  };

  const navItems = [
    { href: '/dashboard', label: 'בית', icon: '🏠' },
    { href: '/dashboard/documents', label: 'מסמכים', icon: '📄' },
    { href: '/dashboard/payments', label: 'תשלומים', icon: '💰' },
    { href: '/dashboard/missing-invoices', label: 'חשבוניות חסרות', icon: '⚠️' },
    { href: '/dashboard/settings', label: 'הגדרות', icon: '⚙️' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-spin mb-3">⟳</div>
          <p className="text-gray-500">טוען...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-blue-900 text-white flex flex-col fixed right-0 top-0 h-full z-10">
        <div className="p-5 border-b border-blue-800">
          <div className="text-2xl mb-1">🤖</div>
          <div className="font-bold text-sm">עובד משרד AI</div>
          <div className="text-blue-300 text-xs mt-1 truncate">{user?.email}</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                pathname === item.href
                  ? 'bg-white text-blue-900'
                  : 'text-blue-100 hover:bg-blue-800'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-blue-800">
          <button
            onClick={handleLogout}
            className="w-full text-blue-300 hover:text-white text-sm py-2 px-3 rounded-lg hover:bg-blue-800 transition-colors text-right"
          >
            🚪 התנתק
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 mr-56 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
