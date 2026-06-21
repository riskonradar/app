"use client";

import {
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

export function WorkspaceControls() {
  const { isLoaded, isSignedIn, user } = useUser();

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
          <span className="metric-label">Profile</span>
          <h2>Personal details</h2>
        </div>
        <p>
          Signed in as {user?.primaryEmailAddress?.emailAddress ?? "your Risk on Radar account"}.
          Use the profile menu to update your session and account details.
        </p>
        <div className="clerk-control-frame account-profile-frame">
          <UserButton />
          <span>{user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account"}</span>
        </div>
      </section>
    </div>
  );
}
