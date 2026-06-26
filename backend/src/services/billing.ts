import Stripe from "stripe";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";

export type BillingState =
  | "trial"
  | "trial_ending"
  | "active"
  | "past_due"
  | "restricted"
  | "paused"
  | "cancelled"
  | "reactivated";

type BillingMetadata = {
  state: BillingState;
  planId: "starter" | "growth" | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  lastCheckoutSessionId: string | null;
  paymentMethodLast4: string | null;
  updatedAt: string;
  processedWebhookEventIds: string[];
};

const TRIAL_DAYS = 14;
const WEBHOOK_EVENT_RETENTION = 200;

let stripeClient: Stripe | null = null;

function stripe(): Stripe {
  if (!config.stripe.secretKey) throw new Error("Stripe is not configured (missing STRIPE_SECRET_KEY)");
  stripeClient ??= new Stripe(config.stripe.secretKey, { apiVersion: "2026-06-24.dahlia" });
  return stripeClient;
}

function defaultTrialEndsAt() {
  const value = new Date();
  value.setDate(value.getDate() + TRIAL_DAYS);
  return value.toISOString();
}

function defaultMetadata(): BillingMetadata {
  return {
    state: "trial",
    planId: null,
    trialEndsAt: defaultTrialEndsAt(),
    nextBillingAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    lastCheckoutSessionId: null,
    paymentMethodLast4: null,
    updatedAt: new Date().toISOString(),
    processedWebhookEventIds: [],
  };
}

function parseMetadata(raw: string | null | undefined): BillingMetadata {
  if (!raw) return defaultMetadata();
  try {
    const parsed = JSON.parse(raw) as Partial<BillingMetadata>;
    return {
      ...defaultMetadata(),
      ...parsed,
      processedWebhookEventIds: Array.isArray(parsed.processedWebhookEventIds)
        ? parsed.processedWebhookEventIds.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return defaultMetadata();
  }
}

async function getBillingIntegration(organizationId: string) {
  const existing = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "billing" } },
    select: { id: true, metadata: true },
  });
  if (existing) return existing;
  return prisma.integration.create({
    data: { organizationId, provider: "billing", metadata: JSON.stringify(defaultMetadata()) },
    select: { id: true, metadata: true },
  });
}

async function setBillingMetadata(organizationId: string, metadata: BillingMetadata) {
  await prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "billing" } },
    update: { metadata: JSON.stringify(metadata), updatedAt: new Date() },
    create: { organizationId, provider: "billing", metadata: JSON.stringify(metadata) },
  });
}

function inferTrialState(metadata: BillingMetadata): BillingState {
  if (!metadata.trialEndsAt) return "trial";
  const daysLeft = Math.ceil((new Date(metadata.trialEndsAt).getTime() - Date.now()) / 86_400_000);
  return daysLeft <= 3 ? "trial_ending" : "trial";
}

export async function getBillingSummary(organizationId: string) {
  const [organization, integration] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    getBillingIntegration(organizationId),
  ]);
  const metadata = parseMetadata(integration.metadata);
  const state = metadata.state === "trial" || metadata.state === "trial_ending" ? inferTrialState(metadata) : metadata.state;
  return {
    organizationName: organization?.name ?? "העסק שלי",
    status: state,
    planName: metadata.planId ? (metadata.planId === "growth" ? "Growth" : "Starter") : null,
    trialEndsAt: metadata.trialEndsAt,
    nextBillingAt: metadata.nextBillingAt,
    readOnly: state === "restricted" || state === "paused" || state === "cancelled",
  };
}

export function getBillingPlans() {
  return [
    {
      id: "starter",
      name: "Starter",
      priceMonthly: 149,
      description: "לעסקים קטנים שרוצים שליטה שקטה בתזרים ובמסמכים.",
      highlights: ["עד 1,000 מסמכים בחודש", "צ'אט AI מובנה", "ניהול ספקים ותשלומים"],
      recommended: false,
      providerPriceId: config.stripe.starterPriceId || null,
    },
    {
      id: "growth",
      name: "Growth",
      priceMonthly: 199,
      description: "לעסקים בצמיחה שצריכים יותר נפח, יותר תובנות ויותר מהירות.",
      highlights: ["עד 5,000 מסמכים בחודש", "ניתוח מתקדם ותובנות", "תמיכה בעדיפות גבוהה"],
      recommended: true,
      providerPriceId: config.stripe.growthPriceId || null,
    },
  ] as const;
}

function planToPriceId(planId: "starter" | "growth") {
  return planId === "starter" ? config.stripe.starterPriceId : config.stripe.growthPriceId;
}

async function getOrCreateStripeCustomer(organizationId: string, metadata: BillingMetadata) {
  if (metadata.stripeCustomerId) return metadata.stripeCustomerId;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!organization) throw new Error("Organization not found");
  const customer = await stripe().customers.create({
    email: organization.user.email,
    name: organization.user.name ?? organization.name,
    metadata: { organizationId },
  });
  return customer.id;
}

export async function createCheckoutSession(params: {
  organizationId: string;
  planId: "starter" | "growth";
  successUrl: string;
  cancelUrl: string;
}) {
  const priceId = planToPriceId(params.planId);
  if (!priceId) throw new Error(`Missing Stripe price id for ${params.planId}`);
  const integration = await getBillingIntegration(params.organizationId);
  const metadata = parseMetadata(integration.metadata);
  const customerId = await getOrCreateStripeCustomer(params.organizationId, metadata);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: false,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      organizationId: params.organizationId,
      planId: params.planId,
    },
  });
  await setBillingMetadata(params.organizationId, {
    ...metadata,
    planId: params.planId,
    stripeCustomerId: customerId,
    lastCheckoutSessionId: session.id,
    updatedAt: new Date().toISOString(),
  });
  return { sessionId: session.id, url: session.url };
}

export async function createPaymentMethodUpdateSession(params: {
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const integration = await getBillingIntegration(params.organizationId);
  const metadata = parseMetadata(integration.metadata);
  const customerId = await getOrCreateStripeCustomer(params.organizationId, metadata);
  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    payment_method_types: ["card"],
    metadata: { organizationId: params.organizationId, purpose: "payment_method_update" },
  });
  await setBillingMetadata(params.organizationId, {
    ...metadata,
    stripeCustomerId: customerId,
    updatedAt: new Date().toISOString(),
  });
  return { sessionId: session.id, url: session.url };
}

export async function applySubscriptionAction(organizationId: string, action: "pause" | "cancel" | "reactivate") {
  const integration = await getBillingIntegration(organizationId);
  const metadata = parseMetadata(integration.metadata);
  const next = { ...metadata, updatedAt: new Date().toISOString() };

  if (action === "pause") {
    next.state = "paused";
  } else if (action === "cancel") {
    next.state = "cancelled";
    if (metadata.stripeSubscriptionId) {
      await stripe().subscriptions.update(metadata.stripeSubscriptionId, { cancel_at_period_end: true });
    }
  } else {
    next.state = "reactivated";
    if (metadata.stripeSubscriptionId) {
      await stripe().subscriptions.update(metadata.stripeSubscriptionId, { cancel_at_period_end: false });
    }
  }

  await setBillingMetadata(organizationId, next);
  await logBillingAudit(organizationId, "billing_action", `Action=${action} state=${next.state}`);
  return getBillingSummary(organizationId);
}

export async function getBillingHistory(organizationId: string) {
  const integration = await getBillingIntegration(organizationId);
  const metadata = parseMetadata(integration.metadata);
  if (!metadata.stripeCustomerId) return [];
  const invoices = await stripe().invoices.list({ customer: metadata.stripeCustomerId, limit: 10 });
  return invoices.data.map((invoice) => ({
    id: invoice.id,
    date: new Date(invoice.created * 1000).toISOString(),
    amount: (invoice.amount_paid || invoice.amount_due || 0) / 100,
    status: invoice.status === "paid" ? "paid" : "pending",
    description: invoice.lines.data[0]?.description ?? "חיוב חודשי",
  }));
}

export async function getValueReport(organizationId: string) {
  const [invoiceCount, supplierPaymentCount, tasksCompleted] = await Promise.all([
    prisma.invoice.count({ where: { organizationId } }),
    prisma.supplierPayment.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId, status: { in: ["done", "completed"] } } }),
  ]);
  const documentsProcessed = invoiceCount + supplierPaymentCount;
  const paymentsIdentified = supplierPaymentCount;
  const hoursSaved = Math.max(1, Math.round((documentsProcessed + tasksCompleted) / 12));
  return [
    { id: "documents", label: "מסמכים שעובדו", value: String(documentsProcessed), helper: "נסרקו, סווגו ונשמרו בצורה מסודרת" },
    { id: "tasks", label: "משימות שבוצעו", value: String(tasksCompleted), helper: "כולל תזכורות ומעקב ספקים" },
    { id: "payments", label: "תשלומים שזוהו", value: String(paymentsIdentified), helper: "עם זיהוי ספק, סכום ומועד" },
    { id: "hours", label: "שעות שנחסכו", value: String(hoursSaved), helper: "הערכה לפי אוטומציה ועבודה ידנית שנחסכה" },
  ];
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | null | undefined) {
  if (!config.stripe.webhookSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  if (!signatureHeader) throw new Error("Missing Stripe signature");
  return stripe().webhooks.constructEvent(rawBody, signatureHeader, config.stripe.webhookSecret);
}

export async function processStripeWebhookEvent(event: Stripe.Event) {
  const organizationId = await extractOrganizationId(event);
  if (!organizationId) return { ignored: true, reason: "no_organization_id" };

  const integration = await getBillingIntegration(organizationId);
  const metadata = parseMetadata(integration.metadata);
  if (metadata.processedWebhookEventIds.includes(event.id)) {
    return { ignored: true, reason: "duplicate_event" };
  }

  const next: BillingMetadata = {
    ...metadata,
    processedWebhookEventIds: [...metadata.processedWebhookEventIds, event.id].slice(-WEBHOOK_EVENT_RETENTION),
    updatedAt: new Date().toISOString(),
  };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    next.state = metadata.state === "cancelled" || metadata.state === "restricted" ? "reactivated" : "active";
    next.planId = ((session.metadata?.planId as "starter" | "growth" | undefined) ?? metadata.planId ?? "growth");
    next.stripeCustomerId = typeof session.customer === "string" ? session.customer : metadata.stripeCustomerId;
    next.stripeSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : metadata.stripeSubscriptionId;
    next.lastCheckoutSessionId = session.id;
  } else if (event.type === "invoice.payment_failed") {
    next.state = "past_due";
  } else if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    next.stripeSubscriptionId = subscription.id;
    next.stripeCustomerId =
      typeof subscription.customer === "string" ? subscription.customer : metadata.stripeCustomerId;
    if (subscription.status === "active" || subscription.status === "trialing") next.state = "active";
    else if (subscription.status === "past_due" || subscription.status === "unpaid") next.state = "past_due";
    else if (subscription.status === "canceled") next.state = "cancelled";
  } else if (event.type === "customer.subscription.deleted") {
    next.state = "cancelled";
  } else if (event.type === "payment_method.attached" || event.type === "setup_intent.succeeded") {
    next.state = next.state === "past_due" ? "active" : next.state;
  }

  await setBillingMetadata(organizationId, next);
  await logBillingAudit(organizationId, "billing_webhook", `event=${event.type} id=${event.id}`);
  return { ignored: false };
}

async function extractOrganizationId(event: Stripe.Event): Promise<string | null> {
  const object = event.data.object as unknown as Record<string, unknown>;
  const fromMetadata = typeof object?.metadata === "object" && object.metadata
    ? (object.metadata as Record<string, string>).organizationId
    : undefined;
  if (fromMetadata) return fromMetadata;

  const maybeCustomerId = typeof object.customer === "string" ? object.customer : null;
  if (!maybeCustomerId) return null;

  const integration = await prisma.integration.findFirst({
    where: { provider: "billing", metadata: { contains: maybeCustomerId } },
    select: { organizationId: true },
  });
  return integration?.organizationId ?? null;
}

async function logBillingAudit(organizationId: string, type: string, body: string) {
  await prisma.alert.create({
    data: {
      organizationId,
      type,
      title: "Billing audit event",
      body,
      read: true,
    },
  });
}
