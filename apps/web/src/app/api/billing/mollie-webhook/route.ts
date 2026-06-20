import { getMollieClient } from "@/lib/mollie/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const paymentId = formData.get("id");

  if (!paymentId || typeof paymentId !== "string") {
    return Response.json({ error: "Missing Mollie payment id." }, { status: 400 });
  }

  const payment = await getMollieClient().payments.get(paymentId);

  // TODO: persist payment status into app.billing_payments once DB writes are enabled.
  return Response.json({
    id: payment.id,
    status: payment.status,
  });
}
