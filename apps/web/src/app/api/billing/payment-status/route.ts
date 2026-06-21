/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentUserAccount } from "@/lib/account/server";
import { persistMolliePayment } from "@/lib/billing/server";
import { getMollieClient } from "@/lib/mollie/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const paymentId = searchParams.get("payment_id");

  if (!paymentId) {
    return Response.json({ error: "Missing payment_id parameter." }, { status: 400 });
  }

  const userAccount = await ensureCurrentUserAccount(request);
  if (!userAccount) {
    return Response.json({ error: "Sign in to check payment status." }, { status: 401 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: paymentRecord } = await (supabase as any).schema("app")
    .from("billing_payments")
    .select("status, mollie_payment_id, organization_id, plan_key, seats")
    .eq("mollie_payment_id", paymentId)
    .eq("user_account_id", userAccount.id)
    .maybeSingle() as any;

  try {
    const molliePayment = await getMollieClient().payments.get(paymentId);
    const metadata = (molliePayment.metadata ?? {}) as { userAccountId?: string; clerkUserId?: string };
    if (metadata.userAccountId && metadata.userAccountId !== userAccount.id) {
      return Response.json({ error: "Payment does not belong to the current account." }, { status: 403 });
    }

    const persistError = await persistMolliePayment(molliePayment, userAccount.id);
    if (persistError) {
      console.error("Failed to persist refreshed payment status:", persistError);
    }

    return Response.json({
      id: paymentId,
      status: molliePayment.status,
    });
  } catch (error) {
    console.error("Failed to fetch status from Mollie:", error);
  }

  if (!paymentRecord) {
    return Response.json({ error: "Payment not found in database or Mollie." }, { status: 404 });
  }

  return Response.json({
    id: paymentId,
    status: paymentRecord.status,
  });
}
