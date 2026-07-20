/* eslint-disable @typescript-eslint/no-explicit-any */

import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";

import { normalizeClerkOrganizationRole } from "@/lib/auth/roles";
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

const TRIAL_ORGANIZATION_SEAT_LIMIT = 3;

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
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
  const { data: existingOrganization, error: existingOrganizationError } = await appSchema()
    .from("organizations")
    .select("billing_status, seat_limit, status")
    .eq("clerk_organization_id", data.id)
    .maybeSingle();

  if (existingOrganizationError) return existingOrganizationError;
  if (existingOrganization?.status === "archived") return null;

  const organizationPayload: Record<string, unknown> = {
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
  };

  if (
    !existingOrganization ||
    (existingOrganization.billing_status === "trialing" && !existingOrganization.seat_limit)
  ) {
    organizationPayload.seat_limit = TRIAL_ORGANIZATION_SEAT_LIMIT;
  }

  const { data: organization, error } = await appSchema()
    .from("organizations")
    .upsert(organizationPayload, { onConflict: "clerk_organization_id" })
    .select("seat_limit")
    .single();

  if (error) return error;

  const seatLimit = Number(organization?.seat_limit ?? TRIAL_ORGANIZATION_SEAT_LIMIT);
  const clerkSeatLimit = Number(data.max_allowed_memberships ?? data.maxAllowedMemberships ?? 0);
  if (seatLimit > 0 && clerkSeatLimit !== seatLimit) {
    try {
      const clerk = await clerkClient();
      await clerk.organizations.updateOrganization(data.id, {
        maxAllowedMemberships: seatLimit,
      });
    } catch (seatError) {
      return seatError instanceof Error
        ? seatError
        : new Error("Could not apply the workspace seat limit in Clerk.");
    }
  }

  return null;
}

async function upsertMembership(data: Record<string, any>) {
  const clerkOrganizationId = data.organization?.id ?? data.organization_id;
  const clerkUserId = data.public_user_data?.user_id ?? data.user_id;
  const organizationId = await findOrganizationId(clerkOrganizationId);
  const userAccountId = await findUserAccountId(clerkUserId);

  if (!organizationId || !userAccountId) {
    return new Error("Clerk membership dependencies are not available yet.");
  }

  let currentMembership;
  try {
    const clerk = await clerkClient();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      userId: [clerkUserId],
      limit: 1,
    });
    currentMembership = memberships.data[0] ?? null;
  } catch (verificationError) {
    return verificationError instanceof Error
      ? verificationError
      : new Error("Could not verify the current Clerk membership.");
  }

  // Signed webhooks may arrive out of order. Clerk's current backend state is
  // authoritative: a stale created/updated event must never reactivate a
  // membership that has since been deleted.
  if (!currentMembership) {
    const { error } = await appSchema()
      .from("organization_memberships")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("user_account_id", userAccountId);
    return error;
  }

  const { error } = await appSchema()
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organizationId,
        user_account_id: userAccountId,
        clerk_membership_id: currentMembership.id,
        role: normalizeClerkOrganizationRole(currentMembership.role),
        status: "active",
        removed_at: null,
      },
      { onConflict: "organization_id,user_account_id" },
    );

  return error;
}

async function removeMembership(data: Record<string, any>) {
  const clerkOrganizationId = data.organization?.id ?? data.organization_id;
  const clerkUserId = data.public_user_data?.user_id ?? data.user_id;
  const organizationId = await findOrganizationId(clerkOrganizationId);
  const userAccountId = await findUserAccountId(clerkUserId);

  if (!organizationId || !userAccountId) {
    return new Error("Clerk membership deletion dependencies are not available yet.");
  }

  try {
    const clerk = await clerkClient();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      userId: [clerkUserId],
      limit: 1,
    });
    const currentMembership = memberships.data[0] ?? null;
    if (currentMembership) {
      const { error } = await appSchema()
        .from("organization_memberships")
        .upsert(
          {
            organization_id: organizationId,
            user_account_id: userAccountId,
            clerk_membership_id: currentMembership.id,
            role: normalizeClerkOrganizationRole(currentMembership.role),
            status: "active",
            removed_at: null,
          },
          { onConflict: "organization_id,user_account_id" },
        );
      return error;
    }
  } catch (verificationError) {
    return verificationError instanceof Error
      ? verificationError
      : new Error("Could not verify the deleted Clerk membership.");
  }

  const { error } = await appSchema()
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organizationId,
        user_account_id: userAccountId,
        clerk_membership_id: data.id,
        role: normalizeClerkOrganizationRole(data.role),
        status: "removed",
        removed_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_account_id" },
    );
  return error;
}

async function archiveUser(clerkUserId: string) {
  const userAccountId = await findUserAccountId(clerkUserId);
  if (!userAccountId) return null;

  const { error: membershipError } = await appSchema()
    .from("organization_memberships")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("user_account_id", userAccountId);
  if (membershipError) return membershipError;

  const { error } = await appSchema()
    .from("user_accounts")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      email: null,
      first_name: null,
      last_name: null,
    })
    .eq("id", userAccountId);
  return error;
}

async function archiveOrganization(clerkOrganizationId: string) {
  const organizationId = await findOrganizationId(clerkOrganizationId);
  if (!organizationId) return null;

  const { error: membershipError } = await appSchema()
    .from("organization_memberships")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("organization_id", organizationId);
  if (membershipError) return membershipError;

  const { error } = await appSchema()
    .from("organizations")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", organizationId);
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
        role: normalizeClerkOrganizationRole(data.role),
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
    const existing = await appSchema()
      .from("user_accounts")
      .select("status")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (existing.error) {
      error = existing.error;
    } else if (existing.data?.status !== "deleted") {
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
  }

  if (event.type === "user.deleted") {
    error = await archiveUser(event.data.id);
  }

  if (["organization.created", "organization.updated"].includes(event.type)) {
    error = await upsertOrganization(event.data);
  }

  if (event.type === "organization.deleted") {
    error = await archiveOrganization(event.data.id);
  }

  if (["organizationMembership.created", "organizationMembership.updated"].includes(event.type)) {
    error = await upsertMembership(event.data);
  }

  if (event.type === "organizationMembership.deleted") {
    error = await removeMembership(event.data);
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
