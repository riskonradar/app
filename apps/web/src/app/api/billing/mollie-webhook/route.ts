import { persistMolliePayment, resolvePaymentUserAccountId } from "@/lib/billing/server";
import { getMollieClient } from "@/lib/mollie/server";

function hasValidWebhookToken(request: Request) {
  const secret = process.env.MOLLIE_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? request.headers.get("x-mollie-webhook-secret");
  return token === secret;
}

export async function POST(request: Request) {
  if (!hasValidWebhookToken(request)) {
    return Response.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ error: "Expected Mollie form payload." }, { status: 400 });
  }

  const paymentId = formData.get("id");

  if (!paymentId || typeof paymentId !== "string") {
    return Response.json({ error: "Missing Mollie payment id." }, { status: 400 });
  }

  let payment;
  try {
    payment = await getMollieClient().payments.get(paymentId);
  } catch (error) {
    console.error("Failed to fetch Mollie payment for webhook:", error);
    return Response.json({ error: "Could not verify Mollie payment." }, { status: 502 });
  }

  const userAccountId = await resolvePaymentUserAccountId(payment);
  if (!userAccountId) {
    return Response.json({ error: "Payment metadata does not reference a known user." }, { status: 202 });
  }

  const error = await persistMolliePayment(payment, userAccountId);
  if (error) {
    console.error("Failed to persist Mollie payment webhook:", error);
    return Response.json({ error: "Failed to persist payment status." }, { status: 500 });
  }

  return Response.json({
    id: payment.id,
    status: payment.status,
  });
}
