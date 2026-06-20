import { SignIn } from "@clerk/nextjs";

import { isClerkConfigured } from "@/lib/config";

export default function SignInPage() {
  if (!isClerkConfigured()) {
    return (
      <main className="auth-page">
        <p className="status-label">Auth not configured</p>
        <h1>Clerk keys are required before sign in is available.</h1>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <SignIn />
    </main>
  );
}
