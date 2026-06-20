import { SignUp } from "@clerk/nextjs";

import { isClerkConfigured } from "@/lib/config";

export default function SignUpPage() {
  if (!isClerkConfigured()) {
    return (
      <main className="auth-page">
        <p className="status-label">Auth not configured</p>
        <h1>Clerk keys are required before sign up is available.</h1>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <SignUp />
    </main>
  );
}
