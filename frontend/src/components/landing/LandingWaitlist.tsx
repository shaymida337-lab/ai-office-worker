"use client";

import { FormEvent, useState } from "react";
import { LANDING_WAITLIST } from "./landingContent";
import { colors, radius, shadow } from "@/lib/design-tokens";

const FORMSPREE_WAITLIST_ID = process.env.NEXT_PUBLIC_FORMSPREE_WAITLIST_ID ?? "";
const FS_BASE = "https://formspree.io/f/";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function submitToFormspree(formId: string, data: FormData) {
  if (!formId) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return;
  }
  const response = await fetch(`${FS_BASE}${formId}`, {
    method: "POST",
    body: data,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("submit_failed");
}

export function LandingWaitlistSection() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const trimmed = email.trim();
    if (!isEmail(trimmed)) {
      setError("נא להזין כתובת אימייל תקינה.");
      return;
    }

    setSubmitting(true);
    try {
      const data = new FormData();
      data.append("email", trimmed);
      data.append("_subject", "הרשמה חדשה לרשימת המתנה — נטלי");
      data.append("source", "waitlist-he");
      data.append("locale", "he");
      data.append("page", typeof window !== "undefined" ? window.location.href : "/");
      await submitToFormspree(FORMSPREE_WAITLIST_ID, data);
      setSuccessEmail(trimmed);
    } catch {
      setError("משהו השתבש. נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="waitlist" className="overflow-x-hidden px-4 pb-16 pt-4 sm:px-6 sm:pb-20">
      <div className="mx-auto max-w-3xl">
        <div
          className={`${radius.card} border ${shadow.card} relative overflow-hidden p-6 sm:p-8`}
          style={{ backgroundColor: colors.textPrimary, borderColor: colors.textPrimary }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            aria-hidden
            style={{
              background:
                "radial-gradient(circle at 80% 0%, rgba(29,91,255,0.45), transparent 55%), radial-gradient(circle at 0% 100%, rgba(31,170,89,0.25), transparent 50%)",
            }}
          />

          <div className="relative z-10 text-center">
            <p
              className="mx-auto mb-3 inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
              style={{ backgroundColor: "rgba(31,170,89,0.16)", color: colors.successBorder }}
            >
              {LANDING_WAITLIST.kicker}
            </p>
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">{LANDING_WAITLIST.title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-base font-medium leading-7 text-white/80">{LANDING_WAITLIST.lead}</p>

            {successEmail ? (
              <div
                className={`mx-auto mt-8 max-w-lg ${radius.lg} border px-5 py-5 text-right`}
                style={{ borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)" }}
                role="status"
              >
                <p className="text-lg font-bold text-white">{LANDING_WAITLIST.successTitle}</p>
                <p className="mt-2 text-sm font-medium text-white/80">
                  נעדכן את <span className="font-bold text-white">{successEmail}</span> ברגע שתיפתח גישה.
                </p>
              </div>
            ) : (
              <>
                <form className="mx-auto mt-8 grid max-w-lg gap-3 sm:grid-cols-[1fr_auto]" onSubmit={onSubmit} noValidate>
                  <label htmlFor="waitlist-email" className="sr-only">
                    כתובת אימייל
                  </label>
                  <input
                    id="waitlist-email"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="כתובת האימייל שלכם"
                    autoComplete="email"
                    required
                    className="min-h-12 border-white/20 bg-white text-ink-primary placeholder:text-ink-muted focus:border-white/40 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.12)]"
                  />
                  <button type="submit" className="btn min-h-12 whitespace-nowrap" disabled={submitting}>
                    {submitting ? "מצטרפים…" : LANDING_WAITLIST.submit}
                  </button>
                </form>
                {error ? (
                  <p className="mt-3 text-sm font-semibold text-red-300" role="alert">
                    {error}
                  </p>
                ) : null}
                <p className="mt-4 text-sm font-medium text-white/65">{LANDING_WAITLIST.note}</p>
              </>
            )}

            <ul className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm font-semibold text-white/85">
              {LANDING_WAITLIST.tags.map((tag) => (
                <li key={tag} className="inline-flex items-center gap-1.5">
                  <span style={{ color: colors.successBorder }} aria-hidden>
                    ✓
                  </span>
                  {tag}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
