import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { PublicPageShell } from "@/components/trust";

export const metadata: Metadata = {
  title: "התחברות",
  description: "התחברות לחשבון נטלי — עובדת המשרד הדיגיטלית שלך",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <PublicPageShell>
      <div className="mx-auto max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-center">נטלי — התחברות</h1>
        <AuthForm mode="login" />
        <p className="mt-8 text-center">
          <Link href="/">חזרה לדף הבית</Link>
        </p>
      </div>
    </PublicPageShell>
  );
}
