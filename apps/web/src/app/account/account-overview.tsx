"use client";

import { SignInButton, useUser } from "@clerk/nextjs";

type AccountOverviewProps = {
  billingStatus: string;
  memberCount: number;
  planName: string;
  role: string;
  workspaceName: string;
  workspaceSlug: string;
};

export function AccountOverview({
  billingStatus,
  memberCount,
  planName,
  role,
  workspaceName,
  workspaceSlug,
}: AccountOverviewProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "there";
  const email = user?.primaryEmailAddress?.emailAddress ?? "Signed in";
  const resolvedWorkspaceName = workspaceName || "Personal workspace";

  return (
    <section className="page-card account-hero">
      <div className="page-heading">
        <span className="metric-label">Account</span>
        <h1>{isLoaded && !isSignedIn ? "Sign in to Risk on Radar" : `Hello, ${displayName}`}</h1>
        <p>Manage your profile, product workspace, and Risk on Radar plan.</p>
      </div>

      {!isLoaded ? (
        <p className="notice standalone">Loading your account...</p>
      ) : isSignedIn ? (
        <div className="account-summary-grid">
          <div className="summary-tile">
            <span>Workspace</span>
            <strong>{resolvedWorkspaceName}</strong>
            <small>{workspaceSlug}</small>
          </div>
          <div className="summary-tile">
            <span>Plan</span>
            <strong>{planName}</strong>
            <small>{billingStatus}</small>
          </div>
          <div className="summary-tile">
            <span>User</span>
            <strong>{email}</strong>
            <small>{role}</small>
          </div>
          <div className="summary-tile">
            <span>Seats</span>
            <strong>{memberCount}</strong>
            <small>{memberCount === 1 ? "active user" : "active users"}</small>
          </div>
        </div>
      ) : (
        <div className="account-signin-panel">
          <p className="notice standalone">Sign in to view your workspace and plan.</p>
          <SignInButton mode="modal">
            <button className="btn btn-primary btn-sm" type="button">
              Sign in
            </button>
          </SignInButton>
        </div>
      )}
    </section>
  );
}
