import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { WorkspaceControls } from "@/components/auth/workspace-controls";
import { billingPlans, getBillingPlan } from "@/lib/billing/plans";
import { getWorkspaceSummary } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load workspace summary:", error);
    return null;
  });
  const activePlan = getBillingPlan(summary?.organization.plan_key);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main account-main">
        <section className="page-card account-hero">
          <div className="page-heading">
            <span className="metric-label">Account Management</span>
            <h1>Workspace, members, and billing</h1>
            <p>
              Risk on Radar uses Clerk for identity and organization access, with Supabase storing
              the product workspace, billing state, review audit trail, and tenant ownership.
            </p>
          </div>

          {summary ? (
            <div className="account-summary-grid">
              <div className="summary-tile">
                <span>Workspace</span>
                <strong>{summary.organization.name}</strong>
                <small>{summary.organization.slug ?? "personal workspace"}</small>
              </div>
              <div className="summary-tile">
                <span>Plan</span>
                <strong>{activePlan?.name ?? summary.organization.plan_key}</strong>
                <small>{summary.organization.billing_status}</small>
              </div>
              <div className="summary-tile">
                <span>Members</span>
                <strong>{summary.memberCount}</strong>
                <small>{summary.pendingInvitationCount} pending invites</small>
              </div>
              <div className="summary-tile">
                <span>Role</span>
                <strong>{summary.role}</strong>
                <small>{summary.organization.seat_limit ?? "custom"} seats</small>
              </div>
            </div>
          ) : (
            <p className="notice standalone">
              Sign in to create or manage a workspace. Individual users can start with a personal
              workspace; teams should create an organization before buying the Team plan.
            </p>
          )}
        </section>

        <WorkspaceControls />

        <section className="page-card account-pricing-summary">
          <div className="section-heading">
            <span className="metric-label">Packaging Direction</span>
            <h2>Plans aligned to B2B engineering buyers</h2>
          </div>
          <div className="plan-strip">
            {billingPlans.map((plan) => (
              <article key={plan.key} className="plan-strip-item">
                <span>{plan.name}</span>
                <strong>{plan.priceLabel}</strong>
                <p>{plan.description}</p>
              </article>
            ))}
          </div>
          <div className="page-actions">
            <Link href="/pricing" className="btn btn-primary btn-sm">
              Review pricing
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
