import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { WorkspaceControls } from "@/components/auth/workspace-controls";
import { BillingLifecycleNotice } from "@/components/billing/billing-lifecycle-notice";
import { CustomerPortalButton } from "@/components/billing/customer-portal-button";
import { MembershipStatus } from "@/components/billing/membership-status";
import { getBillingPlan } from "@/lib/billing/plans";
import { getWorkspaceBillingDetails } from "@/lib/billing/workspace";
import { getWorkspaceSummary } from "@/lib/account/server";
import { AccountOverview } from "./account-overview";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load workspace summary:", error);
    return null;
  });
  const billingDetails = await getWorkspaceBillingDetails(summary?.organization.id).catch((error) => {
    console.error("Failed to load Stripe billing details:", error);
    return null;
  });
  const workspaceName = summary?.organization.name ?? "Personal workspace";
  const workspaceSlug = summary?.organization.slug ?? "personal workspace";
  const serverPlan = summary?.organization.plan_key ?? "free";
  const billingStatus = summary?.organization.billing_status ?? "free";
  const memberCount = summary?.memberCount ?? 1;
  const role = summary?.role ?? "Owner";
  const seatLimit = billingDetails?.seats ?? summary?.organization.seat_limit ?? null;
  const currentPlan = ["active", "comped", "past_due"].includes(billingStatus)
    ? getBillingPlan(serverPlan)
    : null;
  const canManageBilling = role === "owner" || role === "admin";

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main account-main">
        <AccountOverview
          billingStatus={billingStatus}
          memberCount={memberCount}
          seatLimit={seatLimit}
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
          <BillingLifecycleNotice
            cancelAtPeriodEnd={billingDetails?.cancelAtPeriodEnd}
            currentPeriodEnd={billingDetails?.currentPeriodEnd}
            status={billingStatus}
          />
          <div className="account-plan-grid">
            <MembershipStatus serverStatus={summary?.organization.billing_status} serverPlan={summary?.organization.plan_key} />
            <div className="account-plan-detail">
              <article className="plan-strip-item">
                <span>{currentPlan?.name ?? "Free"}</span>
                <strong>{currentPlan?.priceLabel ?? "EUR 0"}</strong>
                <p>
                  {currentPlan?.description ??
                    "For trying the Failure Mode and Effects Analysis workspace with one saved table."}
                </p>
              </article>
              <div className="page-actions">
                <Link href="/pricing" className="btn btn-primary btn-sm">
                  Manage plan
                </Link>
                <Link href="/dashboard" className="btn btn-secondary btn-sm">
                  Open dashboard
                </Link>
                {canManageBilling && billingDetails?.hasStripeCustomer ? (
                  <CustomerPortalButton />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
