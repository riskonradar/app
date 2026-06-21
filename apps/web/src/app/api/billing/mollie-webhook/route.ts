import { getMollieClient } from "@/lib/mollie/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const paymentId = formData.get("id");

  if (!paymentId || typeof paymentId !== "string") {
    return Response.json({ error: "Missing Mollie payment id." }, { status: 400 });
  }

  const payment = await getMollieClient().payments.get(paymentId);
  const supabase = getSupabaseServiceClient();

  // Extract metadata from payment
  const metadata = payment.metadata as any;
  const clerkUserId = metadata?.clerkUserId;
  
  if (!clerkUserId) {
    return Response.json({ error: "Missing clerkUserId in payment metadata." }, { status: 400 });
  }

  // Find user account by clerk user ID
  const { data: userAccount, error: userError } = await supabase
    .from("user_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single() as any;

  if (userError || !userAccount) {
    return Response.json({ error: "User account not found." }, { status: 404 });
  }

  // Persist payment status to database
  const { error: paymentError } = await supabase
    .from("billing_payments")
    .upsert({
      user_account_id: userAccount.id,
      mollie_payment_id: payment.id,
      status: payment.status,
      amount_value: parseFloat(payment.amount?.value || "0"),
      amount_currency: payment.amount?.currency || "EUR",
      checkout_url: payment._links.checkout?.href,
      metadata: metadata || {},
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "mollie_payment_id",
    });

  if (paymentError) {
    console.error("Failed to persist payment status:", paymentError);
    return Response.json({ error: "Failed to persist payment status." }, { status: 500 });
  }

  return Response.json({
    id: payment.id,
    status: payment.status,
  });
}
