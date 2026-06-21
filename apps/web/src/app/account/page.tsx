import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { WorkspaceControls } from "@/components/auth/workspace-controls";
import { MembershipStatus } from "@/components/billing/membership-status";
import { billingPlans } from "@/lib/billing/plans";
import { getWorkspaceSummary } from "@/lib/account/server";
import { AccountOverview } from "./account-overview";

export const dynamic = "force-dynamic";
const demoPlans = billingPlans.filter((plan) => plan.key === "individual");

export default async function AccountPage() {
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load workspace summary:", error);
    return null;
  });
  const workspaceName = summary?.organization.name ?? "Personal workspace";
  const workspaceSlug = summary?.organization.slug ?? "personal workspace";
  const serverPlan = summary?.organization.plan_key ?? "free";
  const billingStatus = summary?.organization.billing_status ?? "free";
  const memberCount = summary?.memberCount ?? 1;
  const role = summary?.role ?? "Owner";

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main account-main">
        <AccountOverview
          billingStatus={billingStatus}
          memberCount={memberCount}
          serverPlan={serverPlan}
          role={role}
          workspaceName={workspaceName}
          workspaceSlug={workspaceSlug}
        />

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
