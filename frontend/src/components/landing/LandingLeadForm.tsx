"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { pushToDataLayer } from "@/lib/analytics/data-layer";
import { captureUtmOnce, getUtm, utmEventParams } from "@/lib/analytics/utm";
import { LANDING_LEAD_FORM } from "./landingContent";
import { PLAN_INTEREST_STORAGE_KEY } from "./LandingPricing";
import { colors, radius, shadow } from "@/lib/design-tokens";

const inputClass =
  "min-h-12 w-full rounded-[14px] border bg-white px-4 py-3 text-[16px] font-medium outline-none transition focus:ring-4";

export function LandingLeadFormSection() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    captureUtmOnce();
  }, []);

  function onFirstInteraction() {
    if (startedRef.current) return;
    startedRef.current = true;
    pushToDataLayer({ event: "lead_form_start", ...utmEventParams() });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // מניעת שליחה כפולה
    setError("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const consent = data.get("consent") === "on";
    if (!consent) {
      setError("כדי שנחזור אליכם צריך לאשר את מדיניות הפרטיות");
      return;
    }

    const utm = getUtm();
    let planInterest: string | null = null;
    try {
      planInterest = sessionStorage.getItem(PLAN_INTEREST_STORAGE_KEY);
    } catch {
      /* storage חסום */
    }

    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      businessType: String(data.get("businessType") ?? ""),
      note: String(data.get("note") ?? ""),
      website: String(data.get("website") ?? ""), // honeypot
      consent,
      planInterest,
      source: utm.source,
      medium: utm.medium,
      campaign: utm.campaign,
      landingPath: utm.landingPath ?? window.location.pathname,
    };

    setSubmitting(true);
    pushToDataLayer({ event: "lead_form_submit", ...utmEventParams() });
    try {
      const response = await fetch(`${API_URL}/api/public/marketing-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (response.ok && body?.ok) {
        // הצלחה אמיתית — רק אחרי שהשרת אישר שמירה ב-DB.
        pushToDataLayer({ event: "lead_form_success", ...utmEventParams() });
        router.push("/thank-you");
        return;
      }
      pushToDataLayer({ event: "lead_form_error", reason: String(response.status), ...utmEventParams() });
      setError(body?.error || LANDING_LEAD_FORM.errorFallback);
    } catch {
      pushToDataLayer({ event: "lead_form_error", reason: "network", ...utmEventParams() });
      setError(LANDING_LEAD_FORM.errorFallback);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="trial" className="overflow-x-hidden px-4 pb-16 pt-4 sm:px-6 sm:pb-20" aria-label="התחלת ניסיון">
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

          <div className="relative z-10">
            <div className="text-center">
              <p
                className="mx-auto mb-3 inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
                style={{ backgroundColor: "rgba(31,170,89,0.16)", color: colors.successBorder }}
              >
                {LANDING_LEAD_FORM.kicker}
              </p>
              <h2 className="text-2xl font-extrabold text-white sm:text-3xl">{LANDING_LEAD_FORM.title}</h2>
              <p className="mx-auto mt-3 max-w-xl text-base font-medium leading-7 text-white/80">
                {LANDING_LEAD_FORM.lead}
              </p>
            </div>

            <form className="mx-auto mt-7 grid max-w-xl gap-3" onSubmit={onSubmit} onFocusCapture={onFirstInteraction}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="lead-name" className="mb-1 block text-sm font-bold text-white/85">
                    {LANDING_LEAD_FORM.fields.name}
                  </label>
                  <input id="lead-name" name="name" required minLength={2} maxLength={80} autoComplete="name" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="lead-phone" className="mb-1 block text-sm font-bold text-white/85">
                    {LANDING_LEAD_FORM.fields.phone}
                  </label>
                  <input id="lead-phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" className={inputClass} dir="ltr" style={{ textAlign: "right" }} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="lead-email" className="mb-1 block text-sm font-bold text-white/85">
                    {LANDING_LEAD_FORM.fields.email}
                  </label>
                  <input id="lead-email" name="email" type="email" required autoComplete="email" className={inputClass} dir="ltr" style={{ textAlign: "right" }} />
                </div>
                <div>
                  <label htmlFor="lead-business" className="mb-1 block text-sm font-bold text-white/85">
                    {LANDING_LEAD_FORM.fields.businessType}
                  </label>
                  <select id="lead-business" name="businessType" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      בחרו...
                    </option>
                    {LANDING_LEAD_FORM.businessTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="lead-note" className="mb-1 block text-sm font-bold text-white/85">
                  {LANDING_LEAD_FORM.fields.note}
                </label>
                <textarea id="lead-note" name="note" maxLength={500} rows={2} className={inputClass} />
              </div>

              {/* Honeypot — מוסתר ממשתמשים, בוטים ממלאים */}
              <div className="absolute -right-[9999px] top-0" aria-hidden>
                <label htmlFor="lead-website">אתר</label>
                <input id="lead-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              </div>

              <label className="flex items-start gap-2 text-sm font-medium text-white/85">
                <input type="checkbox" name="consent" required className="mt-1 h-4 w-4 shrink-0" />
                <span>
                  {LANDING_LEAD_FORM.consentLabel}, בהתאם ל
                  <Link href="/privacy" className="font-bold underline underline-offset-2 hover:text-white">
                    {LANDING_LEAD_FORM.consentPrivacyLabel}
                  </Link>
                  .
                </span>
              </label>

              <button type="submit" className="btn mt-1 min-h-12 w-full sm:w-auto sm:justify-self-center sm:px-10" disabled={submitting} aria-busy={submitting}>
                {submitting ? LANDING_LEAD_FORM.submitting : LANDING_LEAD_FORM.submit}
              </button>

              {error ? (
                <p className="text-center text-sm font-semibold text-red-300" role="alert">
                  {error}
                </p>
              ) : null}

              <p className="text-center text-xs font-medium text-white/60">{LANDING_LEAD_FORM.whyDetails}</p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
