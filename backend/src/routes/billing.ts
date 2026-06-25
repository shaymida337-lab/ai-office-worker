import { Router } from "express";
import { authMiddleware } from "../lib/auth.js";
import { config } from "../lib/config.js";
import {
  applySubscriptionAction,
  createCheckoutSession,
  createPaymentMethodUpdateSession,
  getBillingHistory,
  getBillingPlans,
  getBillingSummary,
  getValueReport,
} from "../services/billing.js";

export const billingRouter = Router();

billingRouter.use(authMiddleware);

function billingErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : "Billing request failed";
  if (/Stripe is not configured|Missing STRIPE_/i.test(message)) {
    return {
      status: 503,
      error: message,
      hint:
        "Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH and retry.",
    };
  }
  return { status: 500, error: message };
}

billingRouter.get("/subscription-status", async (req, res) => {
  try {
    res.json(await getBillingSummary(req.auth!.organizationId));
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});

billingRouter.get("/plans", async (_req, res) => {
  const plans = getBillingPlans().map((plan) => ({
    id: plan.id,
    name: plan.name,
    priceMonthly: plan.priceMonthly,
    description: plan.description,
    highlights: plan.highlights,
    recommended: plan.recommended,
    available: Boolean(plan.providerPriceId),
  }));
  res.json(plans);
});

billingRouter.post("/checkout-session", async (req, res) => {
  try {
    const planId = req.body?.planId as "starter" | "growth" | undefined;
    if (!planId || !["starter", "growth"].includes(planId)) {
      res.status(400).json({ error: "Invalid planId" });
      return;
    }
    const origin = config.frontendUrl;
    const successUrl = `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/billing/failed`;
    res.json(
      await createCheckoutSession({
        organizationId: req.auth!.organizationId,
        planId,
        successUrl,
        cancelUrl,
      })
    );
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});

billingRouter.post("/payment-method/session", async (req, res) => {
  try {
    const origin = config.frontendUrl;
    res.json(
      await createPaymentMethodUpdateSession({
        organizationId: req.auth!.organizationId,
        successUrl: `${origin}/billing/payment-method?updated=1`,
        cancelUrl: `${origin}/billing/payment-method?cancelled=1`,
      })
    );
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});

billingRouter.post("/subscription/action", async (req, res) => {
  try {
    const action = req.body?.action as "pause" | "cancel" | "reactivate" | undefined;
    if (!action || !["pause", "cancel", "reactivate"].includes(action)) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    res.json(await applySubscriptionAction(req.auth!.organizationId, action));
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});

billingRouter.get("/history", async (req, res) => {
  try {
    res.json(await getBillingHistory(req.auth!.organizationId));
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});

billingRouter.get("/value-report", async (req, res) => {
  try {
    res.json(await getValueReport(req.auth!.organizationId));
  } catch (err) {
    const payload = billingErrorMessage(err);
    res.status(payload.status).json(payload);
  }
});
