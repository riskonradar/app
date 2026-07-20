/* eslint-disable @typescript-eslint/no-explicit-any */

import { clerkClient, currentUser } from "@clerk/nextjs/server";

import { getCurrentClerkContext } from "@/lib/auth/server";
import { normalizeClerkOrganizationRole } from "@/lib/auth/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

type UserAccount = {
  id: string;
  clerk_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "active" | "deleted";
};

type OrganizationAccount = {
  id: string;
  clerk_organization_id: string | null;
  name: string;
  slug: string | null;
  plan_key: string;
  billing_status: string;
  seat_limit: number | null;
  status: "active" | "archived";
};

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function personalWorkspaceSlug(clerkUserId: string) {
  return `personal-${clerkUserId.replace(/[^a-zA-Z0-9]+/g, "-").slice(-24)}`;
}

async function verifyClerkOrganizationMembership(
  clerkOrganizationId: string,
  clerkUserId: string,
) {
  try {
    const clerk = await clerkClient();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      userId: [clerkUserId],
      limit: 1,
    });
    return memberships.data[0] ?? null;
  } catch (error) {
    console.error("Failed to verify removed Clerk membership:", error);
    return null;
  }
}

export async function ensureCurrentUserAccount(request?: Request): Promise<UserAccount | null> {
  const { userId } = await getCurrentClerkContext(request);
  if (!userId) {
    return null;
  }

  const user = request ? null : await currentUser().catch(() => null);
  const primaryEmail = user?.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId,
  )?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;

  const { error: insertError } = await appSchema()
    .from("user_accounts")
    .upsert(
      {
        clerk_user_id: userId,
        ...(primaryEmail ? { email: primaryEmail } : {}),
        ...(user?.firstName ? { first_name: user.firstName } : {}),
        ...(user?.lastName ? { last_name: user.lastName } : {}),
      },
      { onConflict: "clerk_user_id", ignoreDuplicates: true },
    );

  if (insertError) {
    console.error("Failed to create user account:", JSON.stringify(insertError), { code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });
    throw new Error("Could not resolve user account.");
  }

  const { data, error } = await appSchema()
    .from("user_accounts")
    .select("id, clerk_user_id, email, first_name, last_name, status")
    .eq("clerk_user_id", userId)
    .single();

  if (error) {
    console.error("Failed to ensure user account:", JSON.stringify(error), { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new Error("Could not resolve user account.");
  }

  const account = data as UserAccount;
  return account.status === "active" ? account : null;
}

export async function ensureCurrentWorkspace(request?: Request): Promise<{
  userAccount: UserAccount;
  organization: OrganizationAccount;
  role: string;
} | null> {
  const context = await getCurrentClerkContext(request);
  const userAccount = await ensureCurrentUserAccount(request);

  if (!context.userId || !userAccount) {
    return null;
  }

  if (context.orgId) {
    const name = context.orgSlug ?? "Engineering workspace";

    const { error: insertOrgError } = await appSchema()
      .from("organizations")
      .upsert(
        {
          clerk_organization_id: context.orgId,
          name,
          slug: context.orgSlug,
          plan_key: "team",
          created_by_user_account_id: userAccount.id,
        },
        { onConflict: "clerk_organization_id", ignoreDuplicates: true },
      );

    if (insertOrgError) {
      console.error("Failed to create organization:", insertOrgError);
      throw new Error("Could not resolve organization.");
    }

    const { data: organization, error: orgError } = await appSchema()
      .from("organizations")
      .select("id, clerk_organization_id, name, slug, plan_key, billing_status, seat_limit, status")
      .eq("clerk_organization_id", context.orgId)
      .single();

    if (orgError) {
      console.error("Failed to ensure organization:", orgError);
      throw new Error("Could not resolve organization.");
    }

    if ((organization as OrganizationAccount).status !== "active") {
      return null;
    }

    const { data: existingMembership, error: existingMembershipError } = await appSchema()
      .from("organization_memberships")
      .select("clerk_membership_id, role, status")
      .eq("organization_id", organization.id)
      .eq("user_account_id", userAccount.id)
      .maybeSingle();
    if (existingMembershipError) {
      console.error("Failed to resolve organization membership:", existingMembershipError);
      throw new Error("Could not resolve organization membership.");
    }

    let role = normalizeClerkOrganizationRole(context.orgRole);
    let clerkMembershipId = existingMembership?.clerk_membership_id ?? null;
    if (existingMembership?.status === "active") {
      // The database role is the authorization source of truth. Avoid writing
      // on every request so a concurrent deletion webhook cannot be undone by
      // a stale session token.
      role = existingMembership.role;
    } else if (existingMembership?.status === "removed") {
      const verified = await verifyClerkOrganizationMembership(context.orgId, context.userId);
      if (!verified) return null;
      role = normalizeClerkOrganizationRole(verified.role);
      clerkMembershipId = verified.id;
    }

    const membershipWrite = existingMembership?.status === "active"
      ? { error: null }
      : await appSchema()
        .from("organization_memberships")
        .upsert(
          {
            organization_id: organization.id,
            user_account_id: userAccount.id,
            clerk_membership_id: clerkMembershipId,
            role,
            status: "active",
            removed_at: null,
          },
          { onConflict: "organization_id,user_account_id" },
        );
    const membershipError = membershipWrite.error;

    if (membershipError) {
      console.error("Failed to ensure membership:", membershipError);
      throw new Error("Could not resolve organization membership.");
    }

    return {
      userAccount,
      organization: organization as OrganizationAccount,
      role,
    };
  }

  const slug = personalWorkspaceSlug(context.userId);
  const { error: insertOrgError } = await appSchema()
    .from("organizations")
    .upsert(
      {
        name: "Personal workspace",
        slug,
        plan_key: "individual",
        seat_limit: 1,
        created_by_user_account_id: userAccount.id,
      },
      { onConflict: "slug", ignoreDuplicates: true },
    );

  if (insertOrgError) {
    console.error("Failed to create personal workspace:", insertOrgError);
    throw new Error("Could not resolve personal workspace.");
  }

  const { data: organization, error: orgError } = await appSchema()
    .from("organizations")
    .select("id, clerk_organization_id, name, slug, plan_key, billing_status, seat_limit, status")
    .eq("slug", slug)
    .single();

  if (orgError) {
    console.error("Failed to ensure personal workspace:", orgError);
    throw new Error("Could not resolve personal workspace.");
  }

  if ((organization as OrganizationAccount).status !== "active") {
    return null;
  }

  const { error: membershipError } = await appSchema()
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organization.id,
        user_account_id: userAccount.id,
        role: "owner",
        status: "active",
        removed_at: null,
      },
      { onConflict: "organization_id,user_account_id" },
    );

  if (membershipError) {
    console.error("Failed to ensure personal membership:", membershipError);
    throw new Error("Could not resolve personal membership.");
  }

  return {
    userAccount,
    organization: organization as OrganizationAccount,
    role: "owner",
  };
}

export async function getWorkspaceSummary() {
  const workspace = await ensureCurrentWorkspace();
  if (!workspace) {
    return null;
  }

  const [{ count: memberCount }, { count: invitationCount }, { data: latestPayment }] =
    await Promise.all([
      appSchema()
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", workspace.organization.id)
        .eq("status", "active"),
      appSchema()
        .from("workspace_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", workspace.organization.id)
        .eq("status", "pending"),
      appSchema()
        .from("billing_payments")
        .select("status, amount_value, amount_currency, plan_key, created_at")
        .eq("organization_id", workspace.organization.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  return {
    ...workspace,
    memberCount: memberCount ?? 0,
    pendingInvitationCount: invitationCount ?? 0,
    latestPayment: latestPayment ?? null,
  };
}
