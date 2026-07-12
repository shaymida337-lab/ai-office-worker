import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "העמוד לא נמצא",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      dir="rtl"
      className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 py-16 text-center"
    >
      <p className="text-6xl font-extrabold text-blue-600" aria-hidden>
        404
      </p>
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">העמוד שחיפשת לא נמצא</h1>
      <p className="max-w-md text-base font-medium leading-7 text-slate-600">
        ייתכן שהקישור השתנה או שהעמוד הוסר. אפשר לחזור לדף הבית או להתחבר לחשבון.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
        >
          חזרה לדף הבית
        </Link>
        <Link
          href="/login"
          className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          התחברות
        </Link>
      </div>
    </main>
  );
}
