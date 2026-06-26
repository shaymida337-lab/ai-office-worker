import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PublicPageShell } from "@/components/trust";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const metadata: Metadata = {
  title: "נטלי — עובדת המשרד הדיגיטלית שלך",
  description: "נטלי עוזרת לעסקים בישראל בניהול מיילים, חשבוניות, מסמכים, תשלומים וסדר משרדי — 24/7.",
};

export default function HomePage() {
  return (
    <PublicPageShell>
      <div className="mx-auto grid min-h-0 flex-1 max-w-5xl place-items-center px-6 py-16 text-center">
        <div className="card max-w-3xl">
          <div className="mb-6 flex justify-center">
            <Logo size="lg" showSubtitle />
          </div>
          <div className="page-kicker">סביבת אוטומציה עסקית</div>
          <h1>נטלי — עובדת המשרד שלך</h1>
          <p className="mx-auto mt-4 max-w-xl">
            עוזרת משרד חכמה לעסקים בישראל — ג׳ימייל, חשבוניות, דרייב, וואטסאפ וסיכומים יומיים.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link className="btn" href="/login">
              התחברות באימייל
            </Link>
            <Link className="btn btn-secondary" href="/signup">
              הרשמה
            </Link>
          </div>
          <p className="mt-5 text-sm">
            או <a href={`${API_URL}/auth/google`}>התחבר עם גוגל</a> (לחיבור ג׳ימייל)
          </p>
          <p className="mt-4 text-sm">
            כבר מחובר? <Link href="/dashboard">לוח בקרה</Link>
          </p>
        </div>
      </div>
    </PublicPageShell>
  );
}
