import { auth, verifyToken } from "@clerk/nextjs/server";

import { getRequiredEnv, isClerkConfigured } from "@/lib/config";

function bearerToken(request?: Request) {
  const authorization = request?.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

async function getRequestTokenContext(request?: Request) {
  const token = bearerToken(request);
  if (!token || !isClerkConfigured()) {
    return null;
  }

  const payload = await verifyToken(token, {
    secretKey: getRequiredEnv("CLERK_SECRET_KEY"),
  }).catch(() => null);

  if (!payload) {
    return null;
  }

  const claims = payload as Record<string, unknown>;

  return {
    userId: typeof claims.sub === "string" ? claims.sub : null,
    orgId: typeof claims.org_id === "string" ? claims.org_id : null,
    orgRole: typeof claims.org_role === "string" ? claims.org_role : null,
    orgSlug: typeof claims.org_slug === "string" ? claims.org_slug : null,
  };
}

export async function getCurrentClerkUserId(request?: Request) {
  if (!isClerkConfigured()) {
    return null;
  }

  const requestContext = await getRequestTokenContext(request);
  if (requestContext?.userId) {
    return requestContext.userId;
  }

  const { userId } = await auth().catch(() => ({ userId: null }));
  return userId;
}

export async function getCurrentClerkContext(request?: Request) {
  if (!isClerkConfigured()) {
    return {
      userId: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
    };
  }

  const requestContext = await getRequestTokenContext(request);
  if (requestContext?.userId) {
    return requestContext;
  }

  const context = await auth().catch(() => null);
  if (!context) {
    return {
      userId: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
    };
  }

  return {
    userId: context.userId,
    orgId: context.orgId,
    orgRole: context.orgRole,
    orgSlug: context.orgSlug,
  };
}
