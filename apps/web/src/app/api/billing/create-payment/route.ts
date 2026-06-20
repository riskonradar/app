import { getCurrentClerkUserId } from "@/lib/auth/server";
import { isClerkConfigured } from "@/lib/config";
import { getMollieClient } from "@/lib/mollie/server";

export async function POST(request: Request) {
  if (!isClerkConfigured()) {
    return Response.json(
      { error: "Clerk must be configured before creating payments." },
      { status: 503 },
    );
  }

  const userId = await getCurrentClerkUserId();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    },
  });

  const checkoutUrl = payment._links.checkout?.href;

  return Response.json({
    id: payment.id,
    status: payment.status,
    checkoutUrl,
  });
}
