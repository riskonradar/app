import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { WorkspaceControls } from "@/components/auth/workspace-controls";
import { MembershipStatus } from "@/components/billing/membership-status";
import { billingPlans, getBillingPlan } from "@/lib/billing/plans";
import { getWorkspaceSummary } from "@/lib/account/server";

export const dynamic = "force-dynamic";
const demoPlans = billingPlans.filter((plan) => plan.key === "individual");

export default async function AccountPage() {
  const user = await currentUser().catch(() => null);
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load workspace summary:", error);
    return null;
  });
  const activePlan = getBillingPlan(summary?.organization.plan_key);
  const displayName = user?.firstName || user?.emailAddresses[0]?.emailAddress || "there";
  const workspaceName = summary?.organization.name ?? (user ? "Personal workspace" : "Risk on Radar workspace");
  const planName = activePlan?.name ?? (summary?.organization.plan_key === "individual" ? "Individual" : "Free");
  const billingStatus = summary?.organization.billing_status ?? (user ? "free" : "sign in required");
  const memberCount = summary?.memberCount ?? (user ? 1 : 0);
  const role = summary?.role ?? (user ? "Owner" : "Guest");

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main account-main">
        <section className="page-card account-hero">
          <div className="page-heading">
            <span className="metric-label">Account</span>
            <h1>{user ? `Hello, ${displayName}` : "Sign in to Risk on Radar"}</h1>
            <p>
              Manage your profile, product workspace, and Risk on Radar plan.
            </p>
          </div>

          {user ? (
            <div className="account-summary-grid">
              <div className="summary-tile">
                <span>Workspace</span>
                <strong>{workspaceName}</strong>
                <small>{summary?.organization.slug ?? "personal workspace"}</small>
              </div>
              <div className="summary-tile">
                <span>Plan</span>
                <strong>{planName}</strong>
                <small>{billingStatus}</small>
              </div>
              <div className="summary-tile">
                <span>User</span>
                <strong>{user.emailAddresses[0]?.emailAddress ?? "Signed in"}</strong>
                <small>{role}</small>
              </div>
              <div className="summary-tile">
                <span>Seats</span>
                <strong>{memberCount}</strong>
                <small>{memberCount === 1 ? "active user" : "active users"}</small>
              </div>
            </div>
          ) : (
            <p className="notice standalone">
              Sign in to view your workspace and plan.
            </p>
          )}
        </section>

        <WorkspaceControls />

        <section className="page-card account-pricing-summary">
          <div className="section-heading">
            <span className="metric-label">Plan</span>
            <h2>Current plan</h2>
          </div>
          <MembershipStatus serverStatus={summary?.organization.billing_status} serverPlan={summary?.organization.plan_key} />
          <div className="plan-strip">
            {demoPlans.map((plan) => (
              <article key={plan.key} className="plan-strip-item">
                <span>{plan.name}</span>
                <strong>{plan.priceLabel}</strong>
                <p>{plan.description}</p>
              </article>
            ))}
          </div>
          <div className="page-actions">
            <Link href="/pricing" className="btn btn-primary btn-sm">
              Manage plan
            </Link>
            <Link href="/dashboard" className="btn btn-secondary btn-sm">
              Open dashboard
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
