import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[rgba(10,10,15,0.72)] px-4 py-8 text-center text-sm text-ink-secondary md:px-8 lg:mr-60">
      <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-3 md:flex-row">
        <p>עובד משרד חכם · אוטומציה עסקית לעסקים בישראל</p>
        <nav className="flex flex-wrap items-center justify-center gap-4" aria-label="קישורי מידע משפטי">
          <Link href="/company">פרטי חברה</Link>
          <Link href="/privacy-policy">מדיניות פרטיות</Link>
          <Link href="/terms">תנאי שימוש</Link>
          <Link href="/data-deletion">מחיקת נתונים</Link>
          <a href="mailto:shaymida337@gmail.com">תמיכה</a>
        </nav>
      </div>
    </footer>
  );
}
