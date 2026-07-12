/**
 * לידים שיווקיים מהאתר הציבורי של נטלי.
 * נשמרים ב-DB בטבלת MarketingLead (נפרדת בכוונה מ-Lead של ה-CRM הפר-ארגוני).
 * הצלחה מוחזרת ללקוח רק אחרי שהשמירה ב-DB הושלמה בפועל.
 */

export type MarketingLeadInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  businessType?: unknown;
  note?: unknown;
  planInterest?: unknown;
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
  landingPath?: unknown;
  consent?: unknown;
  website?: unknown; // honeypot — משתמשים אמיתיים לא רואים את השדה
};

export type ValidatedLead = {
  name: string;
  email: string;
  phone: string;
  businessType: string;
  note: string | null;
  planInterest: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPath: string | null;
  consent: boolean;
};

export type LeadValidation =
  | { ok: true; lead: ValidatedLead }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function asTrimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalField(value: unknown, max: number): string | null {
  const trimmed = asTrimmed(value, max);
  return trimmed ? trimmed : null;
}

export function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]/g, "");
}

export function validateMarketingLead(input: MarketingLeadInput): LeadValidation {
  const name = asTrimmed(input.name, 80);
  if (name.length < 2) return { ok: false, error: "נא למלא שם" };

  const email = asTrimmed(input.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "נא למלא אימייל תקין" };

  const phone = normalizePhone(asTrimmed(input.phone, 30));
  if (!/^\+?\d{9,15}$/.test(phone)) return { ok: false, error: "נא למלא טלפון תקין" };

  const businessType = asTrimmed(input.businessType, 60);
  if (!businessType) return { ok: false, error: "נא לבחור סוג עסק" };

  if (input.consent !== true) {
    return { ok: false, error: "כדי שנחזור אליכם צריך לאשר את מדיניות הפרטיות" };
  }

  return {
    ok: true,
    lead: {
      name,
      email,
      phone,
      businessType,
      note: optionalField(input.note, 500),
      planInterest: optionalField(input.planInterest, 40),
      source: optionalField(input.source, 120),
      medium: optionalField(input.medium, 120),
      campaign: optionalField(input.campaign, 120),
      landingPath: optionalField(input.landingPath, 200),
      consent: true,
    },
  };
}

export type MarketingLeadDeps = {
  createLead: (lead: ValidatedLead) => Promise<{ id: string }>;
  limiter: { allow: (key: string) => boolean };
  log?: (event: Record<string, unknown>) => void;
};

export type MarketingLeadResponse =
  | { status: 200; body: { ok: true; id: string } }
  | { status: 400 | 429 | 500; body: { ok: false; error: string } };

export async function handleMarketingLead(
  input: MarketingLeadInput & { ip: string },
  deps: MarketingLeadDeps
): Promise<MarketingLeadResponse> {
  const log = deps.log ?? ((event) => console.log("[marketingLead]", JSON.stringify(event)));

  // Honeypot: בוט שמילא את השדה מקבל "הצלחה" מדומה ולא נשמר.
  if (typeof input.website === "string" && input.website.trim() !== "") {
    log({ event: "marketing_lead_spam_honeypot" });
    return { status: 200, body: { ok: true, id: "ok" } };
  }

  if (!deps.limiter.allow(input.ip)) {
    log({ event: "marketing_lead_rate_limited" });
    return { status: 429, body: { ok: false, error: "יותר מדי נסיונות — נסו שוב בעוד דקה" } };
  }

  const validation = validateMarketingLead(input);
  if (!validation.ok) {
    return { status: 400, body: { ok: false, error: validation.error } };
  }

  try {
    const created = await deps.createLead(validation.lead);
    // לוג ללא PII — בלי שם/אימייל/טלפון.
    log({
      event: "marketing_lead_created",
      id: created.id,
      businessType: validation.lead.businessType,
      planInterest: validation.lead.planInterest,
      source: validation.lead.source,
      medium: validation.lead.medium,
      campaign: validation.lead.campaign,
    });
    return { status: 200, body: { ok: true, id: created.id } };
  } catch (err) {
    log({ event: "marketing_lead_db_error", message: err instanceof Error ? err.message : "unknown" });
    return {
      status: 500,
      body: { ok: false, error: "משהו השתבש בשמירה — נסו שוב או כתבו לנו במייל" },
    };
  }
}
