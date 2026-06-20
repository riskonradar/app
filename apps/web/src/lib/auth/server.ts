import { auth } from "@clerk/nextjs/server";

import { isClerkConfigured } from "@/lib/config";

export async function getCurrentClerkUserId() {
  if (!isClerkConfigured()) {
    return null;
  }

  const { userId } = await auth();
  return userId;
}
