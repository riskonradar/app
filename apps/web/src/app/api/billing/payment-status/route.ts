/* eslint-disable @typescript-eslint/no-explicit-any */

import type Stripe from "stripe";

import { ensureCurrentUserAccount } from "@/lib/account/server";
import { persistStripeCheckoutSession, persistStripeSubscription } from "@/lib/billing/server";
import { isStripeConfigured } from "@/lib/config";
import { getStripeClient } from "@/lib/stripe/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

function stripeObjectId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return Response.json({ error: "Missing session_id parameter." }, { status: 400 });
  }

  try {
    const userAccount = await ensureCurrentUserAccount(request);
    if (!userAccount) {
      return Response.json({ error: "Sign in to check payment status." }, { status: 401 });
    }

    const supabase = getSupabaseServiceClient();
    const { data: paymentRecord } = await (supabase as any).schema("app")
      .from("billing_payments")
      .select("status, stripe_checkout_session_id, stripe_subscription_id, organization_id, plan_key, seats")
      .eq("stripe_checkout_session_id", sessionId)
      .eq("user_account_id", userAccount.id)
      .maybeSingle() as any;

    if (isStripeConfigured()) {
      try {
        const session = await getStripeClient().checkout.sessions.retrieve(sessionId, {
          expand: ["subscription"],
        });
        const metadata = (session.metadata ?? {}) as { userAccountId?: string; clerkUserId?: string };
        if (metadata.userAccountId && metadata.userAccountId !== userAccount.id) {
          return Response.json({ error: "Checkout Session does not belong to the current account." }, { status: 403 });
        }

        const sessionError = await persistStripeCheckoutSession(session, userAccount.id);
        if (sessionError) {
          console.error("Failed to persist refreshed Stripe Checkout status:", sessionError);
        }

        const subscription =
          typeof session.subscription === "object" && session.subscription
            ? (session.subscription as Stripe.Subscription)
            : null;

        if (subscription) {
          const subscriptionError = await persistStripeSubscription(subscription);
          if (subscriptionError) {
            console.error("Failed to persist refreshed Stripe subscription status:", subscriptionError);
          }
        }

        return Response.json({
          id: sessionId,
          status: session.status,
          paymentStatus: session.payment_status,
          subscriptionStatus: subscription?.status ?? null,
          subscriptionId: stripeObjectId(session.subscription),
        });
      } catch (error) {
        console.error("Failed to fetch status from Stripe:", error);
      }
    }

    if (!paymentRecord) {
      return Response.json({ error: "Checkout Session not found." }, { status: 404 });
    }

    return Response.json({
      id: sessionId,
      status: paymentRecord.status,
      subscriptionId: paymentRecord.stripe_subscription_id,
    });
  } catch (error) {
    console.error("Payment status route failed:", error);
    return Response.json({ error: "Could not verify payment status." }, { status: 500 });
  }
}
