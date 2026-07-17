/* eslint-disable @typescript-eslint/no-explicit-any */

import type Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveStripeSubscriptionBillingForPersistence } from "@/lib/billing/stripe-seats";
import { getStripePriceId, getStripeTeamExtraSeatPriceId } from "@/lib/stripe/server";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const PAST_DUE_SUBSCRIPTION_STATUSES = new Set(["incomplete", "past_due", "unpaid"]);
const CANCELLED_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired", "paused"]);

type StripeMetadata = {
  clerkUserId?: string;
  clerkOrganizationId?: string | null;
  organizationId?: string | null;
  userAccountId?: string | null;
  planKey?: string | null;
  billingScope?: string | null;
  seats?: number | string | null;
  extraSeatPriceId?: string | null;
  checkoutClaimToken?: string | null;
  checkoutContext?: string | null;
};

export type StripeSubscriptionEventContext = {
  eventCreated: number;
  eventId: string;
};

type Workspace = {
  userAccount: { id: string };
  organization: { id: string };
};

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function stripeObjectId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function stripeMetadata(metadata: Stripe.Metadata | null | undefined): StripeMetadata {
  return (metadata ?? {}) as StripeMetadata;
}

function moneyFromStripeAmount(amount: number | null | undefined) {
  return Number(((amount ?? 0) / 100).toFixed(2));
}

function dateFromStripeTimestamp(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function billingStatusForSubscription(subscriptionStatus: string) {
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) return "active";
  if (PAST_DUE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) return "past_due";
  if (CANCELLED_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) return "cancelled";
  return null;
}

async function syncClerkOrganizationSeatLimit(
  organizationId: string,
  clerkOrganizationId: string | null | undefined,
  seats: number,
) {
  let resolvedClerkOrganizationId = clerkOrganizationId || null;

  if (!resolvedClerkOrganizationId) {
    const { data, error } = await appSchema()
      .from("organizations")
      .select("clerk_organization_id")
      .eq("id", organizationId)
      .maybeSingle();

    if (error) return error;
    resolvedClerkOrganizationId = data?.clerk_organization_id ?? null;
  }

  if (!resolvedClerkOrganizationId) return null;

  try {
    const clerk = await clerkClient();
    await clerk.organizations.updateOrganization(resolvedClerkOrganizationId, {
      maxAllowedMemberships: seats,
    });
    return null;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("Could not synchronize the purchased seat limit to Clerk.");
  }
}

export function isEntitlingSubscriptionStatus(subscriptionStatus: string | null | undefined) {
  return Boolean(subscriptionStatus && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus));
}

export async function beginStripeWebhookEvent(event: Stripe.Event) {
  const { data, error } = await appSchema().rpc("claim_stripe_webhook_event", {
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_event_id: event.id,
    p_event_type: event.type,
    p_metadata: {
      apiVersion: event.api_version,
      livemode: event.livemode,
    },
  });

  if (error) return { error };

  const claim = Array.isArray(data) ? data[0] : data;
  return {
    claimed: claim?.claimed === true,
    status: typeof claim?.event_status === "string" ? claim.event_status : null,
  };
}

export async function completeStripeWebhookEvent(eventId: string) {
  const { error } = await appSchema()
    .from("stripe_webhook_events")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("status", "processing");

  return error;
}

export async function failStripeWebhookEvent(eventId: string, errorMessage: string) {
  const { data: eventRecord } = await appSchema()
    .from("stripe_webhook_events")
    .select("metadata")
    .eq("id", eventId)
    .maybeSingle();

  const metadata = (eventRecord?.metadata ?? {}) as Record<string, unknown>;
  const { error } = await appSchema()
    .from("stripe_webhook_events")
    .update({
      status: "failed",
      metadata: {
        ...metadata,
        error: errorMessage,
      },
    })
    .eq("id", eventId)
    .eq("status", "processing");

  return error;
}

export async function ensureStripeCustomer(workspace: Workspace, clerkUserId: string, stripe: Stripe) {
  const { data: existingCustomer, error: existingCustomerError } = await appSchema()
    .from("billing_customers")
    .select("id, stripe_customer_id")
    .eq("organization_id", workspace.organization.id)
    .not("stripe_customer_id", "is", null)
    .maybeSingle();

  if (existingCustomerError) {
    throw existingCustomerError;
  }

  if (existingCustomer?.stripe_customer_id) {
    return String(existingCustomer.stripe_customer_id);
  }

  const customer = await stripe.customers.create(
    {
      metadata: {
        clerkUserId,
        organizationId: workspace.organization.id,
        userAccountId: workspace.userAccount.id,
      },
    },
    { idempotencyKey: `riskonradar-customer-${workspace.organization.id}` },
  );

  const { error: customerError } = await appSchema()
    .from("billing_customers")
    .upsert(
      {
        user_account_id: workspace.userAccount.id,
        organization_id: workspace.organization.id,
        stripe_customer_id: customer.id,
      },
      { onConflict: "organization_id" },
    );

  if (customerError) {
    throw customerError;
  }

  return customer.id;
}

export async function releaseBillingCheckoutClaim(
  organizationId: string,
  claimToken: string,
) {
  const { error } = await appSchema().rpc("release_billing_checkout_claim", {
    p_claim_token: claimToken,
    p_organization_id: organizationId,
  });

  return error;
}

export async function persistStripeExpiredCheckoutSession(session: Stripe.Checkout.Session) {
  const eventMetadata = stripeMetadata(session.metadata);
  const { data: existingPayment, error: existingPaymentError } = await appSchema()
    .from("billing_payments")
    .select("id, user_account_id, organization_id, plan_key, metadata")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (existingPaymentError) {
    return existingPaymentError;
  }

  // A Session can expire after Stripe accepted it but before our payment row was
  // persisted. The unguessable claim token still lets the signed event release
  // only the lease that created this Session.
  if (!existingPayment) {
    if (eventMetadata.organizationId && eventMetadata.checkoutClaimToken) {
      return releaseBillingCheckoutClaim(
        eventMetadata.organizationId,
        eventMetadata.checkoutClaimToken,
      );
    }
    return null;
  }

  const storedMetadata = (existingPayment.metadata ?? {}) as StripeMetadata;
  const claimToken = storedMetadata.checkoutClaimToken ?? eventMetadata.checkoutClaimToken;
  const organizationId = existingPayment.organization_id ?? eventMetadata.organizationId;
  const { error: paymentError } = await appSchema()
    .from("billing_payments")
    .update({
      status: "expired",
      checkout_url: null,
      metadata: {
        ...storedMetadata,
        checkoutExpiredAt: new Date().toISOString(),
        paymentStatus: session.payment_status,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingPayment.id);

  if (paymentError) {
    return paymentError;
  }

  if (organizationId && claimToken) {
    const releaseError = await releaseBillingCheckoutClaim(organizationId, claimToken);
    if (releaseError) return releaseError;
  }

  const { error: auditError } = await appSchema()
    .from("account_audit_events")
    .insert({
      organization_id: organizationId ?? null,
      user_account_id: existingPayment.user_account_id,
      actor_clerk_user_id: storedMetadata.clerkUserId ?? eventMetadata.clerkUserId ?? null,
      event_type: "stripe.checkout_session_expired",
      metadata: {
        stripeCheckoutSessionId: session.id,
        planKey: existingPayment.plan_key,
      },
    });

  return auditError;
}

export async function persistStripeCheckoutSession(session: Stripe.Checkout.Session, userAccountId: string) {
  const metadata = stripeMetadata(session.metadata);
  const { data: existingPayment, error: existingPaymentError } = await appSchema()
    .from("billing_payments")
    .select("id, user_account_id, organization_id, plan_key, seats, amount_value, amount_currency")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (existingPaymentError) {
    return existingPaymentError;
  }

  if (!existingPayment) {
    return new Error("Stripe Checkout Session was not created by this application.");
  }

  if (existingPayment.user_account_id !== userAccountId) {
    return new Error("Stripe Checkout Session user does not match the persisted payment record.");
  }

  const customerId = stripeObjectId(session.customer);
  const subscriptionId = stripeObjectId(session.subscription);
  const planKey = existingPayment.plan_key ?? metadata.planKey ?? null;
  const amountCurrency = String(session.currency ?? existingPayment.amount_currency ?? "eur").toUpperCase();

  if (String(existingPayment.amount_currency || "EUR") !== amountCurrency) {
    return new Error("Stripe Checkout Session currency does not match the persisted payment record.");
  }

  const { error: paymentError } = await appSchema()
    .from("billing_payments")
    .update({
      status: session.status ?? session.payment_status ?? "unknown",
      amount_value: moneyFromStripeAmount(session.amount_total),
      amount_currency: amountCurrency,
      checkout_url: session.url ?? null,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      metadata: {
        ...metadata,
        paymentStatus: session.payment_status,
        subscriptionId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingPayment.id);

  if (paymentError) {
    return paymentError;
  }

  const { error: auditError } = await appSchema()
    .from("account_audit_events")
    .insert({
      organization_id: existingPayment.organization_id ?? metadata.organizationId ?? null,
      user_account_id: userAccountId,
      actor_clerk_user_id: metadata.clerkUserId ?? null,
      event_type: "stripe.checkout_session_updated",
      metadata: {
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: session.status,
        paymentStatus: session.payment_status,
        planKey,
      },
    });

  return auditError;
}

export async function persistStripeSubscription(
  subscription: Stripe.Subscription,
  eventContext?: StripeSubscriptionEventContext,
) {
  const metadata = stripeMetadata(subscription.metadata);
  const existingSubscriptionQuery = await appSchema()
    .from("billing_subscriptions")
    .select("id, organization_id, user_account_id, plan_key, seats")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  if (existingSubscriptionQuery.error) {
    return existingSubscriptionQuery.error;
  }

  const existingSubscription = existingSubscriptionQuery.data;
  const resolvedBilling = resolveStripeSubscriptionBillingForPersistence(
    subscription,
    {
      individualPriceId: getStripePriceId("individual"),
      teamPriceId: getStripePriceId("team"),
      teamExtraSeatPriceId: getStripeTeamExtraSeatPriceId(),
    },
    existingSubscription
      ? {
          planKey: existingSubscription.plan_key,
          seats: existingSubscription.seats,
        }
      : null,
  );
  if (!resolvedBilling) {
    return new Error("Stripe subscription contains an unknown or unsafe price combination.");
  }
  const planKey = resolvedBilling.planKey;
  const organizationId = existingSubscription?.organization_id ?? metadata.organizationId ?? null;
  const userAccountId = existingSubscription?.user_account_id ?? metadata.userAccountId ?? null;
  const customerId = stripeObjectId(subscription.customer);
  const subscriptionItem = subscription.items.data[0];
  const seats = resolvedBilling.seats;

  if (!organizationId || !userAccountId || !planKey) {
    return new Error("Stripe subscription metadata is missing app billing identifiers.");
  }

  const nextBillingStatus = billingStatusForSubscription(subscription.status);
  const subscriptionMetadata = {
    ...metadata,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    priceIds: subscription.items.data.map((item) => stripeObjectId(item.price)).filter(Boolean),
    seats,
  };

  const { data: applyResult, error: subscriptionError } = await appSchema().rpc(
    "apply_stripe_subscription_event",
    {
      p_billing_status: nextBillingStatus,
      p_current_period_end: dateFromStripeTimestamp(subscriptionItem?.current_period_end),
      p_current_period_start: dateFromStripeTimestamp(subscriptionItem?.current_period_start),
      p_event_created_at: eventContext
        ? new Date(eventContext.eventCreated * 1000).toISOString()
        : null,
      p_event_id: eventContext?.eventId ?? null,
      p_metadata: subscriptionMetadata,
      p_organization_id: organizationId,
      p_plan_key: planKey,
      p_seats: seats,
      p_status: subscription.status,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_user_account_id: userAccountId,
    },
  );

  if (subscriptionError) {
    return subscriptionError;
  }

  const applyRow = Array.isArray(applyResult) ? applyResult[0] : applyResult;
  if (applyRow?.applied !== true && applyRow?.current_event !== true) {
    return null;
  }

  if (nextBillingStatus === "active") {
    const seatSyncError = await syncClerkOrganizationSeatLimit(
      organizationId,
      metadata.clerkOrganizationId,
      seats,
    );
    if (seatSyncError) {
      return seatSyncError;
    }
  }

  // The database mutation and its audit record are atomic. An exact-event
  // retry reaches this point only to recover external side effects such as
  // Clerk seat synchronization.
  return null;
}
