import type Stripe from "stripe";

import {
  beginStripeWebhookEvent,
  completeStripeWebhookEvent,
  failStripeWebhookEvent,
  persistStripeCheckoutSession,
  persistStripeExpiredCheckoutSession,
  persistStripeSubscription,
} from "@/lib/billing/server";
import { getStripeWebhookSecret } from "@/lib/config";
import { getStripeClient } from "@/lib/stripe/server";

function stripeObjectId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function subscriptionEventContext(event: Stripe.Event) {
  return {
    eventCreated: event.created,
    eventId: event.id,
  };
}

async function persistCheckoutSession(session: Stripe.Checkout.Session, event: Stripe.Event) {
  const userAccountId = session.metadata?.userAccountId;
  if (!userAccountId) {
    return new Error("Stripe Checkout Session metadata does not reference an app user.");
  }

  const sessionError = await persistStripeCheckoutSession(session, userAccountId);
  if (sessionError) return sessionError;

  const subscriptionId = stripeObjectId(session.subscription);
  if (!subscriptionId) return null;

  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  return persistStripeSubscription(subscription, subscriptionEventContext(event));
}

async function persistInvoiceSubscription(invoice: Stripe.Invoice, event: Stripe.Event) {
  const parent = invoice.parent as { subscription_details?: { subscription?: string | Stripe.Subscription | null } } | null;
  const subscriptionId = stripeObjectId(parent?.subscription_details?.subscription);
  if (!subscriptionId) return null;

  const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
  return persistStripeSubscription(subscription, subscriptionEventContext(event));
}

async function persistCurrentSubscription(
  eventSubscription: Stripe.Subscription,
  event: Stripe.Event,
) {
  const subscription = await getStripeClient().subscriptions.retrieve(eventSubscription.id);
  return persistStripeSubscription(subscription, subscriptionEventContext(event));
}

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return persistCheckoutSession(event.data.object as Stripe.Checkout.Session, event);
    case "checkout.session.expired":
      return persistStripeExpiredCheckoutSession(
        event.data.object as Stripe.Checkout.Session,
      );
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return persistCurrentSubscription(
        event.data.object as Stripe.Subscription,
        event,
      );
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
      return persistInvoiceSubscription(event.data.object as Stripe.Invoice, event);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    return Response.json({ error: "Stripe webhook secret is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;

  try {
    event = getStripeClient().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return Response.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  const webhookEvent = await beginStripeWebhookEvent(event);
  if ("error" in webhookEvent && webhookEvent.error) {
    console.error("Failed to record Stripe webhook event:", webhookEvent.error);
    return Response.json({ error: "Could not record webhook event." }, { status: 500 });
  }

  if (!webhookEvent.claimed) {
    if (webhookEvent.status !== "completed") {
      return Response.json(
        {
          error: "Stripe webhook event is already being processed.",
          received: false,
          status: webhookEvent.status,
        },
        {
          status: 409,
          headers: { "Retry-After": "60" },
        },
      );
    }

    return Response.json({
      received: true,
      duplicate: true,
      status: webhookEvent.status,
    });
  }

  try {
    const error = await handleStripeEvent(event);
    if (error) {
      console.error("Failed to process Stripe webhook:", error);
      await failStripeWebhookEvent(event.id, error.message);
      return Response.json({ error: "Could not process Stripe webhook." }, { status: 500 });
    }
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);
    await failStripeWebhookEvent(event.id, error instanceof Error ? error.message : "Unknown webhook error");
    return Response.json({ error: "Could not process Stripe webhook." }, { status: 500 });
  }

  const completionError = await completeStripeWebhookEvent(event.id);
  if (completionError) {
    console.error("Failed to mark Stripe webhook event complete:", completionError);
    return Response.json({ error: "Could not complete webhook event." }, { status: 500 });
  }

  return Response.json({ received: true });
}
