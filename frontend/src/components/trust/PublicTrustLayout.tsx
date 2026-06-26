import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PublicSiteFooter } from "./PublicSiteFooter";

export function PublicTrustLayout({
  children,
  kicker,
  title,
  updatedAt,
}: {
  children: ReactNode;
  kicker: string;
  title: string;
  updatedAt?: string;
}) {
  return (
    <div className="flex min-h-[100svh] min-h-[100dvh] flex-col bg-white text-right">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-blue-50/90 to-transparent" aria-hidden />

      <header className="relative z-10 border-b border-slate-200/70 bg-white/90 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <Link href="/" className="rounded-xl transition hover:opacity-90" aria-label="נטלי — דף הבית">
            <Logo size="sm" showSubtitle />
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-[2.5rem] items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            התחברות
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <article className="mx-auto w-full max-w-3xl rounded-[1.75rem] border border-slate-200/80 bg-white px-5 py-8 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.18)] sm:px-8 sm:py-10">
          <p className="text-sm font-bold text-blue-600">{kicker}</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">{title}</h1>
          {updatedAt ? <p className="mt-3 text-sm font-medium text-slate-500">עודכן לאחרונה: {updatedAt}</p> : null}
          <div className="mt-8 grid gap-8">{children}</div>
        </article>
      </main>

      <PublicSiteFooter variant="light" />
    </div>
  );
}
