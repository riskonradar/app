"use client";

import {
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

export function WorkspaceControls() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="account-panel account-panel-compact">
        <h2>Loading account</h2>
        <p>Checking the current sign-in state.</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="account-panel account-panel-compact">
        <h2>Sign in required</h2>
        <p>Sign in to manage your account and billing.</p>
        <SignInButton mode="modal">
          <button className="btn btn-primary btn-sm" type="button">
            Sign in
          </button>
        </SignInButton>
      </div>
    );
  }

  return (
    <div className="account-grid">
      <section className="account-panel">
        <div className="section-heading">
          <span className="metric-label">Account</span>
          <h2>Signed in</h2>
        </div>
        <p>Manage your user session here. Team workspace controls will appear after Organizations are enabled in Clerk.</p>
        <div className="clerk-control-frame">
          <UserButton />
        </div>
      </section>
    </div>
  );
}
