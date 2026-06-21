import { getCurrentClerkUserId } from "@/lib/auth/server";
import { isMollieConfigured } from "@/lib/config";
import { getMollieClient } from "@/lib/mollie/server";

export async function POST(request: Request) {
  if (!isMollieConfigured()) {
    return Response.json(
      { error: "Mollie must be configured before creating payments." },
      { status: 503 },
    );
  }

  const userId = await getCurrentClerkUserId();
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
      clerkUserId: userId ?? null,
      checkoutContext: userId ? "signed_in" : "anonymous_prototype",
    },
  });

  const checkoutUrl = payment._links.checkout?.href;

  return Response.json({
    id: payment.id,
    status: payment.status,
    checkoutUrl,
  });
}
