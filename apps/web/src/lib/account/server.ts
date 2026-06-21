/* eslint-disable @typescript-eslint/no-explicit-any */

import { currentUser } from "@clerk/nextjs/server";

import { getCurrentClerkContext } from "@/lib/auth/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

type UserAccount = {
  id: string;
  clerk_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

type OrganizationAccount = {
  id: string;
  clerk_organization_id: string | null;
  name: string;
  slug: string | null;
  plan_key: string;
  billing_status: string;
  seat_limit: number | null;
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

function personalWorkspaceSlug(clerkUserId: string) {
  return `personal-${clerkUserId.replace(/[^a-zA-Z0-9]+/g, "-").slice(-24)}`;
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

  const { data, error } = await appSchema()
    .from("user_accounts")
    .upsert(
      {
        clerk_user_id: userId,
        email: primaryEmail,
        first_name: user?.firstName ?? null,
        last_name: user?.lastName ?? null,
      },
      { onConflict: "clerk_user_id" },
    )
    .select("id, clerk_user_id, email, first_name, last_name")
    .single();

  if (error) {
    console.error("Failed to ensure user account:", error);
    throw new Error("Could not resolve user account.");
  }

  return data as UserAccount;
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

    const { data: organization, error: orgError } = await appSchema()
      .from("organizations")
      .upsert(
        {
          clerk_organization_id: context.orgId,
          name,
          slug: context.orgSlug,
          plan_key: "team",
          created_by_user_account_id: userAccount.id,
        },
        { onConflict: "clerk_organization_id" },
      )
      .select("id, clerk_organization_id, name, slug, plan_key, billing_status, seat_limit")
      .single();

    if (orgError) {
      console.error("Failed to ensure organization:", orgError);
      throw new Error("Could not resolve organization.");
    }

    const role = normalizeRole(context.orgRole);
    const { error: membershipError } = await appSchema()
      .from("organization_memberships")
      .upsert(
        {
          organization_id: organization.id,
          user_account_id: userAccount.id,
          role,
          status: "active",
        },
        { onConflict: "organization_id,user_account_id" },
      );

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
  const { data: organization, error: orgError } = await appSchema()
    .from("organizations")
    .upsert(
      {
        name: "Personal workspace",
        slug,
        plan_key: "individual",
        seat_limit: 1,
        created_by_user_account_id: userAccount.id,
      },
      { onConflict: "slug" },
    )
    .select("id, clerk_organization_id, name, slug, plan_key, billing_status, seat_limit")
    .single();

  if (orgError) {
    console.error("Failed to ensure personal workspace:", orgError);
    throw new Error("Could not resolve personal workspace.");
  }

  const { error: membershipError } = await appSchema()
    .from("organization_memberships")
    .upsert(
      {
        organization_id: organization.id,
        user_account_id: userAccount.id,
        role: "owner",
        status: "active",
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
