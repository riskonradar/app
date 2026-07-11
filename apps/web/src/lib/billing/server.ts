/* eslint-disable @typescript-eslint/no-explicit-any */

import type Stripe from "stripe";

import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { getBillingPlan } from "@/lib/billing/plans";

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
  checkoutContext?: string | null;
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

function parseSeats(value: unknown) {
  return Number.parseInt(String(value ?? "1"), 10) || 1;
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

export function isEntitlingSubscriptionStatus(subscriptionStatus: string | null | undefined) {
  return Boolean(subscriptionStatus && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus));
}

export async function beginStripeWebhookEvent(event: Stripe.Event) {
  const { error } = await appSchema()
    .from("stripe_webhook_events")
    .insert({
      id: event.id,
      type: event.type,
      status: "processing",
      metadata: {
        apiVersion: event.api_version,
        livemode: event.livemode,
      },
    });

  if (!error) return { alreadyProcessed: false as const };
  if (error.code === "23505") {
    const { data: existingEvent, error: existingEventError } = await appSchema()
      .from("stripe_webhook_events")
      .select("status")
      .eq("id", event.id)
      .maybeSingle();

    if (existingEventError) return { error: existingEventError };
    return { alreadyProcessed: existingEvent?.status === "completed" };
  }

  return { error };
}

export async function completeStripeWebhookEvent(eventId: string) {
  const { error } = await appSchema()
    .from("stripe_webhook_events")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId);

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
    .eq("id", eventId);

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

  const customer = await stripe.customers.create({
    metadata: {
      clerkUserId,
      organizationId: workspace.organization.id,
      userAccountId: workspace.userAccount.id,
    },
  });

  const { error: customerError } = await appSchema()
    .from("billing_customers")
    .insert({
      user_account_id: workspace.userAccount.id,
      organization_id: workspace.organization.id,
      stripe_customer_id: customer.id,
    });

  if (customerError) {
    throw customerError;
  }

  return customer.id;
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

export async function persistStripeSubscription(subscription: Stripe.Subscription) {
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
  const planKey = metadata.planKey ?? existingSubscription?.plan_key ?? null;
  const plan = getBillingPlan(planKey);
  const organizationId = metadata.organizationId ?? existingSubscription?.organization_id ?? null;
  const userAccountId = metadata.userAccountId ?? existingSubscription?.user_account_id ?? null;
  const seats = Math.max(Number(plan?.includedSeats ?? 1), parseSeats(metadata.seats ?? existingSubscription?.seats));
  const customerId = stripeObjectId(subscription.customer);
  const subscriptionItem = subscription.items.data[0];

  if (!organizationId || !userAccountId || !planKey) {
    return new Error("Stripe subscription metadata is missing app billing identifiers.");
  }

  const subscriptionPayload = {
    organization_id: organizationId,
    user_account_id: userAccountId,
    plan_key: planKey,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    seats,
    current_period_start: dateFromStripeTimestamp(subscriptionItem?.current_period_start),
    current_period_end: dateFromStripeTimestamp(subscriptionItem?.current_period_end),
    metadata: {
      ...metadata,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      priceId: stripeObjectId(subscriptionItem?.price),
    },
    updated_at: new Date().toISOString(),
  };

  const { error: subscriptionError } = await appSchema()
    .from("billing_subscriptions")
    .upsert(subscriptionPayload, { onConflict: "stripe_subscription_id" });

  if (subscriptionError) {
    return subscriptionError;
  }

  const nextBillingStatus = billingStatusForSubscription(subscription.status);
  if (nextBillingStatus) {
    const updatePayload: Record<string, unknown> = {
      billing_status: nextBillingStatus,
    };

    if (nextBillingStatus === "active") {
      updatePayload.plan_key = planKey;
      updatePayload.seat_limit = seats;
    }

    const { error: orgError } = await appSchema()
      .from("organizations")
      .update(updatePayload)
      .eq("id", organizationId);

    if (orgError) {
      return orgError;
    }
  }

  const { error: auditError } = await appSchema()
    .from("account_audit_events")
    .insert({
      organization_id: organizationId,
      user_account_id: userAccountId,
      actor_clerk_user_id: metadata.clerkUserId ?? null,
      event_type: "stripe.subscription_status_updated",
      metadata: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        planKey,
        seats,
      },
    });

  return auditError;
}
