import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-16">
      <h1 className="text-center">עובד משרד חכם</h1>
      <AuthForm mode="signup" />
      <p className="mt-8 text-center">
        <Link href="/">חזרה לדף הבית</Link>
      </p>
    </div>
  );
}
