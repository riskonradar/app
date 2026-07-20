import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { isClerkConfigured } from "@/lib/config";

export const metadata: Metadata = {
  title: "Create account",
};

export default function SignUpPage() {
  if (!isClerkConfigured()) {
    return (
      <main id="main-content" className="auth-page">
        <p className="status-label">Auth not configured</p>
        <h1>Clerk keys are required before sign up is available.</h1>
      </main>
    );
  }

  return (
    <main id="main-content" className="auth-page" aria-label="Create a Risk on Radar account">
      <h1 className="visually-hidden">Create a Risk on Radar account</h1>
      <SignUp />
    </main>
  );
}
