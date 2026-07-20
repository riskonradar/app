import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";

import { isClerkConfigured } from "@/lib/config";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  if (!isClerkConfigured()) {
    return (
      <main id="main-content" className="auth-page">
        <p className="status-label">Auth not configured</p>
        <h1>Clerk keys are required before sign in is available.</h1>
      </main>
    );
  }

  return (
    <main id="main-content" className="auth-page" aria-label="Sign in to Risk on Radar">
      <h1 className="visually-hidden">Sign in to Risk on Radar</h1>
      <SignIn />
    </main>
  );
}
