/* eslint-disable @typescript-eslint/no-explicit-any */

import { getCurrentClerkContext } from "@/lib/auth/server";
import {
  ensureStripeCustomer,
  releaseBillingCheckoutClaim,
} from "@/lib/billing/server";
import { getBillingPlan, getPlanMonthlyAmount } from "@/lib/billing/plans";
import { requireWorkspaceMutationAccess } from "@/lib/auth/workspace-access";
import {
  isStripeConfigured,
  isStripeLiveMode,
  isStripeTaxEnabled,
} from "@/lib/config";
import {
  getStripeClient,
  getStripePriceId,
  getStripeTeamExtraSeatPriceId,
} from "@/lib/stripe/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

function appBaseUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

function requestedSeats(plan: NonNullable<ReturnType<typeof getBillingPlan>>, value: unknown) {
  if (plan.billingScope === "user") return 1;

  const minimum = plan.includedSeats ?? 1;
  const parsed = Number.parseInt(String(value ?? minimum), 10);
  return Math.min(100, Math.max(minimum, Number.isFinite(parsed) ? parsed : minimum));
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) {
      return Response.json(
        { error: "Stripe Checkout is not configured. Add STRIPE_SECRET_KEY before creating subscriptions." },
        { status: 503 },
      );
    }

    if (isStripeLiveMode() && !isStripeTaxEnabled()) {
      return Response.json(
        { error: "Live Stripe Checkout is blocked until Stripe Tax is configured and enabled." },
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
    const access = await requireWorkspaceMutationAccess(request, "billing");
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }
    const { workspace } = access;

    const plan = getBillingPlan(String(body.planKey ?? workspace.organization.plan_key ?? "individual"));

    if (!plan || !plan.amountValue) {
      return Response.json(
        { error: "This plan requires a sales-led billing setup." },
        { status: 400 },
      );
    }

    const workspaceBillingScope = workspace.organization.clerk_organization_id
      ? "organization"
      : "user";
    if (plan.billingScope !== workspaceBillingScope) {
      return Response.json(
        {
          error: plan.billingScope === "organization"
            ? "Create or select a Clerk organization before starting a Team subscription."
            : "Switch to your personal workspace before starting an Individual subscription.",
        },
        { status: 409 },
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
    const seats = requestedSeats(plan, body.seats);
    const additionalSeats = Math.max(0, seats - (plan.includedSeats ?? 1));
    const extraSeatPriceId = plan.key === "team" && additionalSeats > 0
      ? getStripeTeamExtraSeatPriceId()
      : null;
    if (additionalSeats > 0 && !extraSeatPriceId) {
      return Response.json(
        { error: "Additional Team seats are not configured in Stripe yet." },
        { status: 503 },
      );
    }

    const checkoutLineItems = [
      {
        price: priceId,
        quantity: 1,
      },
      ...(extraSeatPriceId
        ? [{ price: extraSeatPriceId, quantity: additionalSeats }]
        : []),
    ];
    const supabase = getSupabaseServiceClient();
    const checkoutFingerprint = `${plan.key}:${seats}`;
    const { data: claimData, error: claimError } = await (supabase as any)
      .schema("app")
      .rpc("claim_billing_checkout", {
        p_organization_id: workspace.organization.id,
        p_fingerprint: checkoutFingerprint,
      });
    if (claimError) throw claimError;

    const checkoutClaim = Array.isArray(claimData) ? claimData[0] : claimData;
    if (checkoutClaim?.claimed !== true) {
      return Response.json(
        {
          error: checkoutClaim?.reason === "subscription_exists"
            ? "This workspace already has a subscription. Manage it from the billing portal."
            : "A checkout is already being created for this workspace. Retry in a moment.",
        },
        { status: 409 },
      );
    }
    const checkoutClaimToken = checkoutClaim.claim_token;
    const checkoutExpiresAt = Date.parse(String(checkoutClaim.claim_expires_at));
    if (
      typeof checkoutClaimToken !== "string"
      || !checkoutClaimToken
      || !Number.isFinite(checkoutExpiresAt)
    ) {
      throw new Error("The billing checkout claim did not return a valid lease.");
    }

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
      extraSeatPriceId: extraSeatPriceId ?? "",
      checkoutClaimToken,
      checkoutContext: "signed_in",
    };

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: workspace.organization.id,
        line_items: checkoutLineItems,
        success_url: `${baseUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/billing/failed?reason=Checkout%20was%20cancelled.`,
        expires_at: Math.floor(checkoutExpiresAt / 1000),
        allow_promotion_codes: true,
        automatic_tax: { enabled: isStripeTaxEnabled() },
        billing_address_collection: "required",
        customer_update: {
          address: "auto",
          name: "auto",
        },
        metadata,
        tax_id_collection: {
          enabled: true,
          required: "if_supported",
        },
        subscription_data: {
          metadata,
        },
      },
      { idempotencyKey: `riskonradar-checkout-${checkoutClaimToken}` },
    );

    const expireUnpersistedSession = async () => {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (error) {
        // Keep the lease when Stripe expiry is ambiguous. An identical retry
        // reuses the same idempotency key instead of creating a second Session.
        console.error("Failed to expire an unpersisted Stripe Checkout Session:", error);
        return;
      }

      const releaseError = await releaseBillingCheckoutClaim(
        workspace.organization.id,
        checkoutClaimToken,
      );
      if (releaseError) {
        console.error("Failed to release the abandoned billing checkout claim:", releaseError);
      }
    };

    if (!session.url) {
      console.error("Stripe Checkout Session was created without a checkout URL:", session.id);
      await expireUnpersistedSession();
      return Response.json(
        { error: "Stripe did not return a checkout URL. Please try again." },
        { status: 502 },
      );
    }

    const { error: paymentError } = await (supabase as any).schema("app")
      .from("billing_payments")
      .upsert(
        {
          user_account_id: workspace.userAccount.id,
          organization_id: workspace.organization.id,
          plan_key: plan.key,
          seats,
          stripe_checkout_session_id: session.id,
          stripe_customer_id: customerId,
          status: session.status ?? "open",
          amount_value: getPlanMonthlyAmount(plan, seats),
          amount_currency: "EUR",
          checkout_url: session.url,
          metadata,
        },
        { onConflict: "stripe_checkout_session_id" },
      );

    if (paymentError) {
      console.error("Failed to create Stripe checkout record:", paymentError);
      await expireUnpersistedSession();
      return Response.json(
        { error: "Could not persist Stripe Checkout. Please try again." },
        { status: 500 },
      );
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
          stripeExtraSeatPriceId: extraSeatPriceId,
          planKey: plan.key,
          seats,
          additionalSeats,
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
