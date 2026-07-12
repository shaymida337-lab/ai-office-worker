import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ShareBar } from "@/components/ShareBar";
import { LEGAL_NAV_LINKS } from "@/lib/trust/links";
import {
  TRUST_COMPANY_NAME,
  TRUST_COPYRIGHT_YEAR,
  TRUST_PRODUCT_NAME,
  TRUST_SUPPORT_EMAIL,
} from "@/lib/trust/constants";

type PublicSiteFooterProps = {
  variant?: "light" | "dark";
  className?: string;
};

export function PublicSiteFooter({ variant = "light", className = "" }: PublicSiteFooterProps) {
  const isLight = variant === "light";

  return (
    <footer
      className={`mt-auto border-t px-4 py-8 sm:px-6 ${
        isLight
          ? "border-slate-200/80 bg-white"
          : "border-[var(--border)] bg-[rgba(10,10,15,0.72)] text-ink-secondary lg:mr-60"
      } ${className}`}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-5 text-center">
        <Link href="/" className="inline-flex" aria-label="נטלי — דף הבית">
          <Logo size="sm" iconOnly />
        </Link>
        <nav
          className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold ${
            isLight ? "text-slate-600" : "text-ink-secondary"
          }`}
          aria-label="קישורים משפטיים ומידע"
        >
          {LEGAL_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`transition ${isLight ? "hover:text-blue-700" : "hover:text-ink-primary"}`}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/security"
            className={`transition ${isLight ? "hover:text-blue-700" : "hover:text-ink-primary"}`}
          >
            אבטחה
          </Link>
          <Link
            href="/data-deletion"
            className={`transition ${isLight ? "hover:text-blue-700" : "hover:text-ink-primary"}`}
          >
            מחיקת נתונים
          </Link>
        </nav>

        <div className="grid gap-2">
          <p className={`text-sm font-bold ${isLight ? "text-slate-600" : "text-ink-secondary"}`}>
            מכירים בעל עסק שטובע בניירת? שתפו את נטלי
          </p>
          <ShareBar variant={variant} />
        </div>

        <div className={`grid gap-1 text-sm ${isLight ? "text-slate-500" : "text-ink-muted"}`}>
          <p>
            {TRUST_PRODUCT_NAME} · עובדת המשרד הדיגיטלית שלך ·{" "}
            <a
              href={`mailto:${TRUST_SUPPORT_EMAIL}`}
              className={`font-semibold ${isLight ? "text-slate-700 hover:text-blue-700" : "text-ink-primary hover:underline"}`}
            >
              {TRUST_SUPPORT_EMAIL}
            </a>
          </p>
          <p className="text-xs sm:text-sm">
            © {TRUST_COPYRIGHT_YEAR} {TRUST_COMPANY_NAME}. כל הזכויות שמורות.
          </p>
        </div>
      </div>
    </footer>
  );
}
