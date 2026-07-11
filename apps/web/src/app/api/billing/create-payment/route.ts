/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getCurrentClerkContext } from "@/lib/auth/server";
import { ensureStripeCustomer } from "@/lib/billing/server";
import { getBillingPlan } from "@/lib/billing/plans";
import { isStripeConfigured } from "@/lib/config";
import { getStripeClient, getStripePriceId } from "@/lib/stripe/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

function appBaseUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) {
      return Response.json(
        { error: "Stripe Checkout is not configured. Add STRIPE_SECRET_KEY before creating subscriptions." },
        { status: 503 },
      );
    }

    const clerkContext = await getCurrentClerkContext(request);
    if (!clerkContext.userId) {
      return Response.json(
        { error: "Sign in before opening Stripe Checkout." },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const workspace = await ensureCurrentWorkspace(request);
    if (!workspace) {
      return Response.json(
        { error: "Could not prepare your account for checkout. Refresh the page and try again." },
        { status: 409 },
      );
    }

    if (workspace.role !== "owner" && workspace.role !== "admin") {
      return Response.json(
        { error: "Only workspace owners and admins can manage billing." },
        { status: 403 },
      );
    }

    const plan = getBillingPlan(String(body.planKey ?? workspace.organization.plan_key ?? "individual"));

    if (!plan || !plan.amountValue) {
      return Response.json(
        { error: "This plan requires a sales-led billing setup." },
        { status: 400 },
      );
    }

    const priceId = getStripePriceId(plan.key);
    if (!priceId) {
      return Response.json(
        { error: `Stripe price ID is not configured for the ${plan.name} plan.` },
        { status: 503 },
      );
    }

    const stripe = getStripeClient();
    const seats = Number(plan.includedSeats ?? 1);
    const customerId = await ensureStripeCustomer(workspace, clerkContext.userId, stripe);
    const baseUrl = appBaseUrl(request);
    const metadata = {
      clerkUserId: clerkContext.userId,
      clerkOrganizationId: clerkContext.orgId ?? "",
      organizationId: workspace.organization.id,
      userAccountId: workspace.userAccount.id,
      planKey: plan.key,
      planName: plan.name,
      productName: `Risk on Radar ${plan.name} plan`,
      billingScope: plan.billingScope,
      billingPeriod: "monthly",
      seats: String(seats),
      checkoutContext: "signed_in",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspace.organization.id,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing/failed?reason=Checkout%20was%20cancelled.`,
      allow_promotion_codes: true,
      metadata,
      subscription_data: {
        metadata,
      },
    });

    if (!session.url) {
      console.error("Stripe Checkout Session was created without a checkout URL:", session.id);
      return Response.json(
        { error: "Stripe did not return a checkout URL. Please try again." },
        { status: 502 },
      );
    }

    const supabase = getSupabaseServiceClient();
    const { error: paymentError } = await (supabase as any).schema("app")
      .from("billing_payments")
      .insert({
        user_account_id: workspace.userAccount.id,
        organization_id: workspace.organization.id,
        plan_key: plan.key,
        seats,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: customerId,
        status: session.status ?? "open",
        amount_value: Number(plan.amountValue),
        amount_currency: "EUR",
        checkout_url: session.url,
        metadata,
      });

    if (paymentError) {
      console.error("Failed to create Stripe checkout record:", paymentError);
    }

    const { error: auditError } = await (supabase as any).schema("app")
      .from("account_audit_events")
      .insert({
        organization_id: workspace.organization.id,
        user_account_id: workspace.userAccount.id,
        actor_clerk_user_id: clerkContext.userId,
        event_type: "stripe.checkout_session_created",
        metadata: {
          stripeCheckoutSessionId: session.id,
          stripeCustomerId: customerId,
          stripePriceId: priceId,
          planKey: plan.key,
          seats,
        },
      });

    if (auditError) {
      console.error("Failed to record checkout audit event:", auditError);
    }

    return Response.json({
      id: session.id,
      status: session.status,
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error("Create Stripe Checkout Session failed:", error);
    return Response.json(
      { error: "Could not open Stripe Checkout. Please try again in a moment." },
      { status: 500 },
    );
  }
}
