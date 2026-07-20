/* eslint-disable @typescript-eslint/no-explicit-any */

import { requireWorkspaceMutationAccess } from "@/lib/auth/workspace-access";
import {
  getStripeCustomerPortalConfigurationId,
  isStripeConfigured,
  isStripeLiveMode,
} from "@/lib/config";
import { resolveStripeSubscriptionBilling } from "@/lib/billing/stripe-seats";
import {
  getStripeClient,
  getStripePriceId,
  getStripeTeamExtraSeatPriceId,
} from "@/lib/stripe/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

function appBaseUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return Response.json(
      { error: "Stripe billing is not configured." },
      { status: 503 },
    );
  }

  try {
    const access = await requireWorkspaceMutationAccess(request, "billing");
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    const { workspace } = access;
    const app = (getSupabaseServiceClient() as any).schema("app");
    const { data: customer, error: customerError } = await app
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("organization_id", workspace.organization.id)
      .not("stripe_customer_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer?.stripe_customer_id) {
      return Response.json(
        { error: "No Stripe billing account exists for this workspace yet." },
        { status: 404 },
      );
    }

    const configuration = getStripeCustomerPortalConfigurationId();
    if (isStripeLiveMode() && !configuration) {
      return Response.json(
        { error: "Live billing management requires a constrained Stripe Portal configuration." },
        { status: 503 },
      );
    }

    const stripe = getStripeClient();
    if (configuration) {
      const portalConfiguration = await stripe.billingPortal.configurations.retrieve(configuration);
      if (portalConfiguration.features.subscription_update.enabled) {
        return Response.json(
          { error: "Stripe Portal plan and quantity changes must be disabled for this billing model." },
          { status: 503 },
        );
      }
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: String(customer.stripe_customer_id),
      status: "all",
      limit: 20,
    });
    const priceConfiguration = {
      individualPriceId: getStripePriceId("individual"),
      teamPriceId: getStripePriceId("team"),
      teamExtraSeatPriceId: getStripeTeamExtraSeatPriceId(),
    };
    const unsafeSubscription = subscriptions.data.find((subscription) => {
      return !["canceled", "incomplete_expired"].includes(subscription.status)
        && !resolveStripeSubscriptionBilling(subscription, priceConfiguration);
    });
    if (unsafeSubscription) {
      return Response.json(
        { error: "This subscription has an unsupported Stripe price configuration. Contact support." },
        { status: 409 },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: String(customer.stripe_customer_id),
      return_url: `${appBaseUrl(request)}/account`,
      ...(configuration ? { configuration } : {}),
    });

    const { error: auditError } = await app.from("account_audit_events").insert({
      organization_id: workspace.organization.id,
      user_account_id: workspace.userAccount.id,
      actor_clerk_user_id: workspace.userAccount.clerk_user_id,
      event_type: "stripe.customer_portal_opened",
      metadata: {
        stripeCustomerId: customer.stripe_customer_id,
        stripePortalSessionId: session.id,
      },
    });

    if (auditError) {
      console.error("Failed to record customer portal audit event:", auditError);
    }

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Create Stripe customer portal session failed:", error);
    return Response.json(
      { error: "Could not open billing management. Please try again." },
      { status: 500 },
    );
  }
}
