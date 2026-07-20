"use client";

import {
  OrganizationSwitcher,
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";
import Link from "next/link";

import { maskEmail } from "@/lib/account/display";

export function WorkspaceControls() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="account-panel account-panel-compact">
        <h2>Account provider unavailable</h2>
        <p>Clerk must be configured before profile and organization controls are available.</p>
      </div>
    );
  }

  return <ConfiguredWorkspaceControls />;
}

function ConfiguredWorkspaceControls() {
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
          Signed in as {maskEmail(user?.primaryEmailAddress?.emailAddress)}.
          Use the profile menu to update your session and account details.
        </p>
        <div className="clerk-control-frame account-profile-frame">
          <UserButton />
          <span>{user?.fullName || maskEmail(user?.primaryEmailAddress?.emailAddress) || "Account"}</span>
        </div>
      </section>
      <section className="account-panel">
        <div className="section-heading">
          <span className="metric-label">Workspace</span>
          <h2>Organization</h2>
        </div>
        <p>Select the personal or team workspace that owns analyses and billing.</p>
        <div className="clerk-control-frame organization-switcher-frame">
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/account"
            afterLeaveOrganizationUrl="/account"
            afterSelectOrganizationUrl="/account"
            afterSelectPersonalUrl="/account"
            organizationProfileMode="navigation"
            organizationProfileUrl="/organization"
          />
          <Link href="/organization" className="btn btn-secondary btn-sm">
            Manage members
          </Link>
        </div>
      </section>
    </div>
  );
}
