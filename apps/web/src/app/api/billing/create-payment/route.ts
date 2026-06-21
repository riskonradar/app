import { getCurrentClerkUserId } from "@/lib/auth/server";
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

  const userId = await getCurrentClerkUserId();
  if (!userId) {
    return Response.json(
      { error: "Sign in before opening Mollie checkout." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const amountValue = String(body.amountValue ?? "49.00");
  const description = String(body.description ?? "Risk on Radar MVP access");

  const payment = await getMollieClient().payments.create({
    amount: {
      currency: "EUR",
      value: amountValue,
    },
    description,
    redirectUrl:
      process.env.MOLLIE_REDIRECT_URL ?? "http://localhost:3000/billing/return",
    webhookUrl: process.env.MOLLIE_WEBHOOK_URL,
    metadata: {
      clerkUserId: userId,
      checkoutContext: "signed_in",
    },
  });

  const checkoutUrl = payment._links.checkout?.href;
  const supabase = getSupabaseServiceClient();

  // Find user account by clerk user ID
  const { data: userAccount, error: userError } = await supabase
    .from("user_accounts")
    .select("id")
    .eq("clerk_user_id", userId)
    .single() as any;

  if (userError || !userAccount) {
    return Response.json({ error: "User account not found." }, { status: 404 });
  }

  // Create initial payment record in database
  const { error: paymentError } = await supabase
    .from("billing_payments")
    .insert({
      user_account_id: userAccount.id,
      mollie_payment_id: payment.id,
      status: payment.status,
      amount_value: parseFloat(payment.amount?.value || "0"),
      amount_currency: payment.amount?.currency || "EUR",
      checkout_url: checkoutUrl,
      metadata: payment.metadata || {},
    });

  if (paymentError) {
    console.error("Failed to create payment record:", paymentError);
    return Response.json({ error: "Failed to create payment record." }, { status: 500 });
  }

  return Response.json({
    id: payment.id,
    status: payment.status,
    checkoutUrl,
  });
}
