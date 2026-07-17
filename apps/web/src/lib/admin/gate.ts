import { currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";

function adminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requireAdmin() {
  const user = await currentUser();
  if (!user) {
    notFound();
  }

  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId,
  )?.emailAddress;

  if (!primaryEmail || !adminEmails().has(primaryEmail.trim().toLowerCase())) {
    notFound();
  }

  return user;
}
