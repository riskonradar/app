import { Webhook } from "svix";

import { getSupabaseServiceClient } from "@/lib/supabase/server";

type ClerkUserEvent = {
  type: string;
  data: {
    id: string;
    email_addresses: { email_address: string; id: string }[];
    primary_email_address_id: string;
    first_name: string | null;
    last_name: string | null;
  };
};

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await request.text();

  let event: ClerkUserEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkUserEvent;
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  if (!["user.created", "user.updated"].includes(event.type)) {
    return Response.json({ received: true });
  }

  const { id: clerkUserId, email_addresses, primary_email_address_id, first_name, last_name } = event.data;
  const primaryEmail = email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ?? null;

  const supabase = getSupabaseServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).schema("app").from("user_accounts").upsert(
    {
      clerk_user_id: clerkUserId,
      email: primaryEmail,
      first_name: first_name ?? null,
      last_name: last_name ?? null,
    },
    { onConflict: "clerk_user_id" },
  );

  if (error) {
    console.error("Failed to upsert user account:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  return Response.json({ received: true });
}
