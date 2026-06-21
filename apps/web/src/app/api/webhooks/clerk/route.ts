/* eslint-disable @typescript-eslint/no-explicit-any */

import { Webhook } from "svix";

import { getSupabaseServiceClient } from "@/lib/supabase/server";

type ClerkUserEvent = {
  type: string;
  data: Record<string, any> & {
    id: string;
    email_addresses: { email_address: string; id: string }[];
    primary_email_address_id: string;
    first_name: string | null;
    last_name: string | null;
  };
};

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function normalizeRole(role: string | null | undefined) {
  if (role === "org:admin" || role === "admin") {
    return "admin";
  }

  if (role === "org:owner" || role === "owner") {
    return "owner";
  }

  return "member";
}

async function findUserAccountId(clerkUserId: string | null | undefined) {
  if (!clerkUserId) {
    return null;
  }

  const { data } = await appSchema()
    .from("user_accounts")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  return data?.id ?? null;
}

async function findOrganizationId(clerkOrganizationId: string | null | undefined) {
  if (!clerkOrganizationId) {
    return null;
  }

  const { data } = await appSchema()
    .from("organizations")
    .select("id")
    .eq("clerk_organization_id", clerkOrganizationId)
    .maybeSingle();

  return data?.id ?? null;
}

async function upsertOrganization(data: Record<string, any>) {
  const createdByUserAccountId = await findUserAccountId(data.created_by ?? data.created_by_user_id);

  const { error } = await appSchema()
    .from("organizations")
    .upsert(
      {
        clerk_organization_id: data.id,
        name: data.name ?? "Engineering workspace",
        slug: data.slug ?? null,
        domain: data.domains?.[0]?.name ?? null,
        created_by_user_account_id: createdByUserAccountId,
        metadata: {
          imageUrl: data.image_url ?? null,
          publicMetadata: data.public_metadata ?? {},
          privateMetadata: data.private_metadata ?? {},
        },
      },
      { onConflict: "clerk_organization_id" },
    );

  return error;
}

async function upsertMembership(data: Record<string, any>) {
  const clerkOrganizationId = data.organization?.id ?? data.organization_id;
  const clerkUserId = data.public_user_data?.user_id ?? data.user_id;
  const organizationId = await findOrganizationId(clerkOrganizationId);
  const userAccountId = await findUserAccountId(clerkUserId);

  if (!organizationId || !userAccountId) {
    return null;
  }

  const { error } = await appSchema()
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organizationId,
        user_account_id: userAccountId,
        clerk_membership_id: data.id,
        role: normalizeRole(data.role),
        status: "active",
      },
      { onConflict: "organization_id,user_account_id" },
    );

  return error;
}

async function upsertInvitation(data: Record<string, any>) {
  const clerkOrganizationId = data.organization?.id ?? data.organization_id;
  const organizationId = await findOrganizationId(clerkOrganizationId);
  const invitedByUserAccountId = await findUserAccountId(data.created_by_user_id);

  if (!organizationId) {
    return null;
  }

  const { error } = await appSchema()
    .from("workspace_invitations")
    .upsert(
      {
        organization_id: organizationId,
        clerk_invitation_id: data.id,
        email: data.email_address ?? data.email ?? "unknown@example.com",
        role: normalizeRole(data.role),
        status: data.status ?? "pending",
        invited_by_user_account_id: invitedByUserAccountId,
      },
      { onConflict: "clerk_invitation_id" },
    );

  return error;
}

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

  let error = null;

  if (["user.created", "user.updated"].includes(event.type)) {
    const { id: clerkUserId, email_addresses, primary_email_address_id, first_name, last_name } = event.data;
    const primaryEmail = email_addresses.find((e) => e.id === primary_email_address_id)?.email_address ?? null;

    const result = await appSchema().from("user_accounts").upsert(
      {
        clerk_user_id: clerkUserId,
        email: primaryEmail,
        first_name: first_name ?? null,
        last_name: last_name ?? null,
      },
      { onConflict: "clerk_user_id" },
    );
    error = result.error;
  }

  if (["organization.created", "organization.updated"].includes(event.type)) {
    error = await upsertOrganization(event.data);
  }

  if (["organizationMembership.created", "organizationMembership.updated"].includes(event.type)) {
    error = await upsertMembership(event.data);
  }

  if (event.type === "organizationMembership.deleted") {
    const { error: deleteError } = await appSchema()
      .from("organization_memberships")
      .update({ status: "removed" })
      .eq("clerk_membership_id", event.data.id);
    error = deleteError;
  }

  if (["organizationInvitation.created", "organizationInvitation.updated"].includes(event.type)) {
    error = await upsertInvitation(event.data);
  }

  if (error) {
    console.error("Failed to process Clerk webhook:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  return Response.json({ received: true });
}
