/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getCurrentClerkContext } from "@/lib/auth/server";
import { getBillingPlan } from "@/lib/billing/plans";
import { isMollieConfigured } from "@/lib/config";
import { getMollieClient } from "@/lib/mollie/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isMollieConfigured()) {
    return Response.json(
      { error: "Mollie must be configured before creating payments." },
      { status: 503 },
    );
  }

  const clerkContext = await getCurrentClerkContext(request);
  if (!clerkContext.userId) {
    return Response.json(
      { error: "Sign in before opening Mollie checkout." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const workspace = await ensureCurrentWorkspace(request).catch((error) => {
    console.error("Checkout will continue without persisted workspace:", error);
    return null;
  });
  const plan = getBillingPlan(String(body.planKey ?? workspace?.organization.plan_key ?? "individual"));

  if (!plan || !plan.amountValue) {
    return Response.json(
      { error: "This plan requires a sales-led billing setup." },
      { status: 400 },
    );
  }

  const seats = Math.max(
    Number(plan.includedSeats ?? 1),
    Number.parseInt(String(body.seats ?? plan.includedSeats ?? 1), 10) || 1,
  );
  const amountValue = plan.amountValue;
  const description = `Risk on Radar ${plan.name} plan`;
  const redirectUrl = process.env.MOLLIE_REDIRECT_URL ?? new URL("/billing/return", request.url).toString();
  const webhookUrl = process.env.MOLLIE_WEBHOOK_URL || undefined;

  const payment = await getMollieClient().payments.create({
    amount: {
      currency: "EUR",
      value: amountValue,
    },
    description,
    redirectUrl,
    ...(webhookUrl ? { webhookUrl } : {}),
    metadata: {
      clerkUserId: clerkContext.userId,
      clerkOrganizationId: clerkContext.orgId ?? null,
      organizationId: workspace?.organization.id ?? `demo-${clerkContext.userId}`,
      userAccountId: workspace?.userAccount.id ?? clerkContext.userId,
      planKey: plan.key,
      planName: plan.name,
      productName: `Risk on Radar ${plan.name} plan`,
      billingScope: plan.billingScope,
      billingPeriod: "monthly",
      seats,
      checkoutContext: workspace ? "signed_in" : "signed_in_demo",
    },
  });

  const checkoutUrl = payment._links.checkout?.href;

  // Create initial payment record in database
  if (workspace) {
    const supabase = getSupabaseServiceClient();
    const { error: paymentError } = await (supabase as any).schema("app")
      .from("billing_payments")
      .insert({
        user_account_id: workspace.userAccount.id,
        organization_id: workspace.organization.id,
        plan_key: plan.key,
        seats,
        mollie_payment_id: payment.id,
        status: payment.status,
        amount_value: parseFloat(payment.amount?.value || "0"),
        amount_currency: payment.amount?.currency || "EUR",
        checkout_url: checkoutUrl,
        metadata: payment.metadata || {},
      });

    if (paymentError) {
      console.error("Failed to create payment record:", paymentError);
    }

    const { error: auditError } = await (supabase as any).schema("app")
      .from("account_audit_events")
      .insert({
        organization_id: workspace.organization.id,
        user_account_id: workspace.userAccount.id,
        actor_clerk_user_id: clerkContext.userId,
        event_type: "mollie.checkout_created",
        metadata: {
          molliePaymentId: payment.id,
          planKey: plan.key,
          seats,
        },
      });

    if (auditError) {
      console.error("Failed to record checkout audit event:", auditError);
    }
  }

  return Response.json({
    id: payment.id,
    status: payment.status,
    checkoutUrl,
  });
}
