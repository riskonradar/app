"use client";

import { SignInButton, useUser } from "@clerk/nextjs";

import { maskEmail, resolvePlanDisplay } from "@/lib/account/display";

type AccountOverviewProps = {
  billingStatus: string;
  hasWorkspaceData?: boolean;
  memberCount: number;
  seatLimit?: number | null;
  serverPlan: string;
  role: string;
  workspaceName: string;
  workspaceSlug: string;
};

export function AccountOverview({
  billingStatus,
  hasWorkspaceData = true,
  memberCount,
  seatLimit,
  serverPlan,
  role,
  workspaceName,
  workspaceSlug,
}: AccountOverviewProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const displayName =
    user?.firstName ||
    user?.fullName ||
    maskEmail(user?.primaryEmailAddress?.emailAddress) ||
    "there";
  const email = maskEmail(user?.primaryEmailAddress?.emailAddress);
  const resolvedWorkspaceName = workspaceName || "Personal workspace";
  const plan = resolvePlanDisplay({
    serverPlan,
    serverStatus: billingStatus.toLowerCase(),
  });

  return (
    <section className="page-card account-hero">
      <div className="page-heading">
        <span className="metric-label">Account</span>
        <h1>{isLoaded && !isSignedIn ? "Sign in to Risk on Radar" : `Hello, ${displayName}`}</h1>
        <p>Manage your profile, product workspace, and Risk on Radar plan.</p>
      </div>

      {!isLoaded ? (
        <p className="notice standalone" role="status" aria-live="polite">Loading your account...</p>
      ) : isSignedIn && !hasWorkspaceData ? (
        <div className="account-data-error" role="alert">
          <strong>Workspace details are unavailable</strong>
          <p>
            We could not verify your workspace, role, or plan. Refresh the page before making billing or access decisions.
          </p>
        </div>
      ) : isSignedIn ? (
        <div className="account-summary-grid">
          <div className="summary-tile">
            <span>Workspace</span>
            <strong>{resolvedWorkspaceName}</strong>
            <small>{workspaceSlug}</small>
          </div>
          <div className="summary-tile">
            <span>Plan</span>
            <strong>{plan.name}</strong>
            <small>{plan.status}</small>
          </div>
          <div className="summary-tile">
            <span>User</span>
            <strong>{email || "Email unavailable"}</strong>
            <small>{role}</small>
          </div>
          <div className="summary-tile">
            <span>Seats</span>
            <strong>{seatLimit ? `${memberCount} of ${seatLimit}` : memberCount}</strong>
            <small>{seatLimit ? "active seats" : memberCount === 1 ? "active user" : "active users"}</small>
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
