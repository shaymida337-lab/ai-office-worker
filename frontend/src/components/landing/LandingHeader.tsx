"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { captureUtmOnce } from "@/lib/analytics/utm";
import { LANDING_NAV } from "./landingContent";
import { colors, radius } from "@/lib/design-tokens";
import { Menu, X } from "lucide-react";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    captureUtmOnce(); // לכידת UTM בנגיעה ראשונה — לפני כל אינטראקציה
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b transition-shadow duration-200 ${
        scrolled ? "shadow-card" : ""
      }`}
      style={{
        borderColor: colors.borderSubtle,
        backgroundColor: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 md:py-3.5">
        <Link href="/" className="min-w-0 shrink-0" aria-label="נטלי — דף הבית">
          <Logo size="sm" showSubtitle className="max-w-[min(100%,14rem)]" />
        </Link>

        <nav
          className="hidden items-center gap-6 text-sm font-semibold md:flex"
          style={{ color: colors.textSecondary }}
          aria-label="ניווט ראשי"
        >
          {LANDING_NAV.map((item) => (
            <a key={item.href} href={item.href} className="transition hover:text-accent-primary">
              {item.label}
            </a>
          ))}
          <Link href="/login" className="transition hover:text-accent-primary">
            התחברות
          </Link>
        </nav>

        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Mobile-first: auth actions always visible — no need to open the menu */}
          <Link
            href="/login"
            className={`${radius.control} inline-flex min-h-10 items-center justify-center border px-2.5 text-xs font-bold sm:px-3 sm:text-sm md:hidden`}
            style={{ borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary }}
            data-testid="header-login"
          >
            התחברות
          </Link>
          <Link
            href="/signup"
            className="btn inline-flex min-h-10 px-2.5 py-2 text-xs sm:px-3 sm:text-sm md:hidden"
            data-testid="header-signup"
          >
            התחלת ניסיון חינם
          </Link>

          <Link href="/natalie" className="btn hidden min-h-10 px-4 py-2 text-sm md:inline-flex">
            לדבר עם נטלי
          </Link>
          <Link href="/signup" className="btn hidden min-h-10 px-4 py-2 text-sm md:inline-flex">
            התחלת ניסיון חינם
          </Link>
          <button
            type="button"
            className={`${radius.control} inline-flex h-10 w-10 items-center justify-center border md:hidden`}
            style={{ borderColor: colors.border, backgroundColor: colors.surface, color: colors.textPrimary }}
            aria-label={open ? "סגירת תפריט" : "פתיחת תפריט"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <div
          className="border-t px-4 py-4 md:hidden"
          style={{ borderColor: colors.borderSubtle, backgroundColor: colors.surface }}
        >
          <nav className="grid gap-1" aria-label="ניווט נייד">
            {LANDING_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`${radius.control} px-3 py-3 text-sm font-semibold`}
                style={{ color: colors.textPrimary }}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <Link href="/natalie" className="btn mt-2 w-full" onClick={() => setOpen(false)}>
              לדבר עם נטלי — דמו חי
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
