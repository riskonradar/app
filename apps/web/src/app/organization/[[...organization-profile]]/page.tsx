import type { Metadata } from "next";

import { AppNav } from "@/components/app-nav";
import { OrganizationManager } from "./organization-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Organization",
  description: "Manage the active engineering workspace and member access.",
};

export default function OrganizationPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main organization-main" tabIndex={-1}>
        <section className="organization-heading">
          <span className="metric-label">Workspace</span>
          <h1>Organization and members</h1>
          <p>Manage the active organization, invitations, and member roles.</p>
        </section>
        <div className="clerk-organization-frame">
          {clerkConfigured ? (
            <OrganizationManager />
          ) : (
            <p className="notice standalone">Clerk Organizations is not configured.</p>
          )}
        </div>
      </main>
    </div>
  );
}
