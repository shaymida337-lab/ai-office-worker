import './globals.css';

export const metadata = {
  title: 'עובד משרד AI',
  description: 'ניהול חשבוניות ותשלומים אוטומטי לעסק קטן',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
