import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PublicPageShell } from "@/components/trust";

export const metadata: Metadata = {
  title: "הרשמה",
  description: "פתיחת חשבון נטלי — התחילו לנהל את המשרד הדיגיטלי שלכם",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-center">נטלי — הרשמה</h1>
        <AuthForm mode="signup" />
        <p className="mt-8 text-center text-sm text-slate-600">
          בהרשמה אתם מאשרים את{" "}
          <Link href="/terms" className="font-semibold text-blue-700 hover:underline">
            תנאי השימוש
          </Link>{" "}
          ואת{" "}
          <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">
            מדיניות הפרטיות
          </Link>
          .
        </p>
        <p className="mt-4 text-center">
          <Link href="/">חזרה לדף הבית</Link>
        </p>
      </div>
    </PublicPageShell>
  );
}
