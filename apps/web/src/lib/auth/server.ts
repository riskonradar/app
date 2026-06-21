import { auth } from "@clerk/nextjs/server";

import { isClerkConfigured } from "@/lib/config";

export async function getCurrentClerkUserId() {
  if (!isClerkConfigured()) {
    return null;
  }

  const { userId } = await auth();
  return userId;
}

export async function getCurrentClerkContext() {
  if (!isClerkConfigured()) {
    return {
      userId: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
    };
  }

  const context = await auth();

  return {
    userId: context.userId,
    orgId: context.orgId,
    orgRole: context.orgRole,
    orgSlug: context.orgSlug,
  };
}
