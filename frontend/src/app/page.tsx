import Link from "next/link";
import { Logo } from "@/components/Logo";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function HomePage() {
  return (
    <div className="mx-auto grid min-h-screen max-w-5xl place-items-center px-6 py-16 text-center">
      <div className="card max-w-3xl">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" showSubtitle />
        </div>
        <div className="page-kicker">Premium automation workspace</div>
        <h1>AI Office Worker</h1>
        <p className="mx-auto mt-4 max-w-xl">
        עוזר משרד חכם לעסקים בישראל — Gmail, חשבוניות, Drive, WhatsApp וסיכומים יומיים.
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
        או{" "}
        <a href={`${API_URL}/auth/google`}>התחבר עם Google</a> (לחיבור Gmail)
      </p>
        <p className="mt-4 text-sm">
        כבר מחובר? <Link href="/dashboard">לוח בקרה</Link>
      </p>
      </div>
    </div>
  );
}
