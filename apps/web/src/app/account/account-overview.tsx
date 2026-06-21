"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import { useMemo, useSyncExternalStore } from "react";

import { maskEmail, parseLocalMembership, resolvePlanDisplay } from "@/lib/account/display";

type AccountOverviewProps = {
  billingStatus: string;
  memberCount: number;
  serverPlan: string;
  role: string;
  workspaceName: string;
  workspaceSlug: string;
};

function subscribeToMembership(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("riskonradar-membership-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("riskonradar-membership-change", callback);
  };
}

function getMembershipSnapshot() {
  return window.localStorage.getItem("riskonradar-membership");
}

function getServerMembershipSnapshot() {
  return null;
}

export function AccountOverview({
  billingStatus,
  memberCount,
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
  const localStatusSnapshot = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const localStatus = useMemo(() => parseLocalMembership(localStatusSnapshot), [localStatusSnapshot]);
  const plan = resolvePlanDisplay({
    localMembership: localStatus,
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
            <strong>{plan.name}</strong>
            <small>{plan.status}</small>
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
