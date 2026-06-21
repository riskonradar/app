/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSupabaseServiceClient } from "@/lib/supabase/server";

const ACTIVE_PAYMENT_STATUSES = new Set(["paid", "authorized"]);
const PAST_DUE_PAYMENT_STATUSES = new Set(["failed", "expired"]);
const CANCELLED_PAYMENT_STATUSES = new Set(["canceled", "cancelled"]);

type PaymentMetadata = {
  clerkUserId?: string;
  clerkOrganizationId?: string | null;
  organizationId?: string | null;
  userAccountId?: string | null;
  planKey?: string | null;
  billingScope?: string | null;
  seats?: number | string | null;
  checkoutContext?: string | null;
};

type MolliePaymentLike = {
  id: string;
  status: string;
  amount?: {
    value?: string;
    currency?: string;
  };
  metadata?: unknown;
  _links?: {
    checkout?: {
      href?: string;
    };
  };
};

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function paymentMetadata(payment: MolliePaymentLike): PaymentMetadata {
  return (payment.metadata ?? {}) as PaymentMetadata;
}

function parseSeats(value: unknown) {
  return Number.parseInt(String(value ?? "1"), 10) || 1;
}

function billingStatusForPayment(paymentStatus: string) {
  if (ACTIVE_PAYMENT_STATUSES.has(paymentStatus)) {
    return "active";
  }

  if (PAST_DUE_PAYMENT_STATUSES.has(paymentStatus)) {
    return "past_due";
  }

  if (CANCELLED_PAYMENT_STATUSES.has(paymentStatus)) {
    return "cancelled";
  }

  return null;
}

export function isEntitlingPaymentStatus(paymentStatus: string) {
  return ACTIVE_PAYMENT_STATUSES.has(paymentStatus);
}

export async function resolvePaymentUserAccountId(payment: MolliePaymentLike) {
  const metadata = paymentMetadata(payment);
  if (metadata.userAccountId) {
    return metadata.userAccountId;
  }

  if (!metadata.clerkUserId) {
    return null;
  }

  const { data } = await appSchema()
    .from("user_accounts")
    .select("id")
    .eq("clerk_user_id", metadata.clerkUserId)
    .maybeSingle();

  return data?.id ?? null;
}

export async function persistMolliePayment(payment: MolliePaymentLike, userAccountId: string) {
  const metadata = paymentMetadata(payment);
  const seats = parseSeats(metadata.seats);
  const organizationId = metadata.organizationId ?? null;
  const planKey = metadata.planKey ?? null;

  const { error: paymentError } = await appSchema()
    .from("billing_payments")
    .upsert(
      {
        user_account_id: userAccountId,
        organization_id: organizationId,
        plan_key: planKey,
        seats,
        mollie_payment_id: payment.id,
        status: payment.status,
        amount_value: Number.parseFloat(payment.amount?.value || "0"),
        amount_currency: payment.amount?.currency || "EUR",
        checkout_url: payment._links?.checkout?.href ?? null,
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mollie_payment_id" },
    );

  if (paymentError) {
    return paymentError;
  }

  const nextBillingStatus = billingStatusForPayment(payment.status);
  if (organizationId && planKey && nextBillingStatus) {
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
      event_type: "mollie.payment_status_updated",
      metadata: {
        molliePaymentId: payment.id,
        status: payment.status,
        planKey,
        seats,
      },
    });

  return auditError;
}
