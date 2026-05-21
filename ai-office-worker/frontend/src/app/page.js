'use client';
import { useState } from 'react';
import { apiClient } from '@/lib/api';

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !email.includes('@') || !password || password.length < 6) {
      setError('אנא הכנס אימייל וסיסמה תקינים. הסיסמה חייבת להכיל לפחות 6 תווים.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (whatsapp) sessionStorage.setItem('pending_whatsapp', whatsapp);

      const { data } = await apiClient.login(email, password);
      localStorage.setItem('ai_office_token', data.token);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בהתחברות. נסה שוב.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo + headline */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🤖</div>
          <h1 className="text-3xl font-bold text-white mb-2">עובד משרד AI</h1>
          <p className="text-blue-200 text-lg">ניהול חשבוניות ותשלומים אוטומטי</p>
          <p className="text-blue-100 text-sm mt-2">התחבר באמצעות מייל מקומי לצורך הדגמה מקומית - אין צורך בחשבון Google מאומת.</p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {[
            { icon: '📨', text: 'סריקת מיילים אוטומטית' },
            { icon: '📊', text: 'טבלת נתונים מסודרת' },
            { icon: '☁️', text: 'שמירת קבצים בענן' },
            { icon: '☀️', text: 'סיכום יומי ב-08:00' },
          ].map(f => (
            <div key={f.text} className="bg-white/10 backdrop-blur rounded-xl p-3 flex items-center gap-2">
              <span className="text-xl">{f.icon}</span>
              <span className="text-white text-sm font-medium">{f.text}</span>
            </div>
          ))}
        </div>

        {/* Registration card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">התחל עכשיו - בחינם</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                כתובת אימייל *
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="כתובת@מייל.com"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                סיסמה *
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="לפחות 6 תווים"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                מספר WhatsApp (אופציונלי - לסיכומים עתידיים)
              </label>
              <input
                type="tel"
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                placeholder="050-0000000"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 text-center">
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 text-lg transition-colors"
            >
              {loading ? (
                <span className="animate-spin">⟳</span>
              ) : (
                <>
                  <span className="text-xl">🔑</span>
                  התחבר עם אימייל וסיסמה
                </>
              )}
            </button>

            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/google`}
              className="w-full inline-flex items-center justify-center gap-3 mt-4 border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 font-bold py-3 rounded-xl transition-colors"
            >
              <span className="text-xl">🟢</span>
              התחבר עם Google
            </a>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            המערכת מבקשת גישה לקריאת המיילים, שמירת קבצים ועדכון הטבלה בלבד.<br/>
            לא מוחקים שום דבר. אף פעם.
          </p>
        </div>
      </div>
    </div>
  );
}
