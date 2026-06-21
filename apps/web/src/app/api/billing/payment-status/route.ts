import { getCurrentClerkUserId } from "@/lib/auth/server";
import { getMollieClient } from "@/lib/mollie/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const paymentId = searchParams.get("payment_id");

  if (!paymentId) {
    return Response.json({ error: "Missing payment_id parameter." }, { status: 400 });
  }

  const userId = await getCurrentClerkUserId();
  if (!userId) {
    return Response.json({ error: "Sign in to check payment status." }, { status: 401 });
  }

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

  // Get payment status from our database
  const { data: paymentRecord, error: paymentError } = await supabase
    .from("billing_payments")
    .select("status, mollie_payment_id")
    .eq("mollie_payment_id", paymentId)
    .eq("user_account_id", userAccount.id)
    .single() as any;

  if (paymentError || !paymentRecord) {
    return Response.json({ error: "Payment record not found." }, { status: 404 });
  }

  // Optionally refresh status from Mollie to ensure it's up to date
  try {
    const molliePayment = await getMollieClient().payments.get(paymentId);
    
    // Update our database if the status has changed
    if (molliePayment.status !== paymentRecord.status) {
      await supabase
        .from("billing_payments")
        .update({ 
          status: molliePayment.status,
          updated_at: new Date().toISOString(),
        })
        .eq("mollie_payment_id", paymentId);
      
      return Response.json({
        id: paymentId,
        status: molliePayment.status,
      });
    }
  } catch (error) {
    console.error("Failed to fetch status from Mollie:", error);
    // Fall back to database status
  }

  return Response.json({
    id: paymentId,
    status: paymentRecord.status,
  });
}
