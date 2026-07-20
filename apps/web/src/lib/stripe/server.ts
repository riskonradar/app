import Stripe from "stripe";

import { getRequiredEnv } from "@/lib/config";
import type { BillingPlanKey } from "@/lib/billing/plans";

export const STRIPE_API_VERSION = "2026-06-24.dahlia";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  return stripeClient;
}

export function getStripePriceId(planKey: BillingPlanKey) {
  const envByPlan: Record<BillingPlanKey, string | undefined> = {
    individual: process.env.STRIPE_INDIVIDUAL_PRICE_ID,
    team: process.env.STRIPE_TEAM_PRICE_ID,
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
  };

  return envByPlan[planKey] || null;
}

export function getStripeTeamExtraSeatPriceId() {
  return process.env.STRIPE_TEAM_EXTRA_SEAT_PRICE_ID || null;
}
