import type { Metadata } from "next";
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
export const metadata: Metadata = {
  title: "Account",
  description: "Manage your Risk on Radar workspace, identity, and billing.",
};

export default async function AccountPage() {
  const summaryResult = await getWorkspaceSummary()
    .then((summary) => ({ summary, failed: false }))
    .catch((error) => {
      console.error("Failed to load workspace summary:", error);
      return { summary: null, failed: true };
    });
  const { summary } = summaryResult;
  const billingResult = summary
    ? await getWorkspaceBillingDetails(summary.organization.id)
      .then((details) => ({ details, failed: false }))
      .catch((error) => {
        console.error("Failed to load Stripe billing details:", error);
        return { details: null, failed: true };
      })
    : { details: null, failed: false };
  const billingDetails = billingResult.details;
  const workspaceName = summary?.organization.name ?? "";
  const workspaceSlug = summary?.organization.slug ?? "";
  const serverPlan = summary?.organization.plan_key ?? "";
  const billingStatus = summary?.organization.billing_status ?? "";
  const memberCount = summary?.memberCount ?? 0;
  const role = summary?.role ?? "";
  const seatLimit = billingDetails?.seats ?? summary?.organization.seat_limit ?? null;
  const currentPlan = ["active", "comped", "past_due"].includes(billingStatus)
    ? getBillingPlan(serverPlan)
    : null;
  const canManageBilling = role === "owner" || role === "admin";

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main account-main" tabIndex={-1}>
        <AccountOverview
          billingStatus={billingStatus}
          hasWorkspaceData={Boolean(summary) && !summaryResult.failed}
          memberCount={memberCount}
          seatLimit={seatLimit}
          serverPlan={serverPlan}
          role={role}
          workspaceName={workspaceName}
          workspaceSlug={workspaceSlug}
        />

        <WorkspaceControls />

        <section className="page-card account-pricing-summary" aria-labelledby="current-plan-heading">
          <div className="section-heading">
            <span className="metric-label">Plan</span>
            <h2 id="current-plan-heading">Current plan</h2>
          </div>
          {summaryResult.failed ? (
            <div className="account-data-error" role="alert">
              <strong>Plan details could not be verified</strong>
              <p>Refresh the page or sign in again. No plan or billing status is being assumed.</p>
            </div>
          ) : !summary ? (
            <p className="notice standalone" role="status">
              Sign in and select a workspace to view a verified plan and billing status.
            </p>
          ) : (
            <>
              {billingResult.failed ? (
                <div className="billing-lifecycle-notice is-warning" role="alert">
                  <strong>Billing details are temporarily unavailable</strong>
                  <p>Your verified workspace plan is shown below, but invoices and renewal timing could not be loaded.</p>
                </div>
              ) : (
                <BillingLifecycleNotice
                  cancelAtPeriodEnd={billingDetails?.cancelAtPeriodEnd}
                  currentPeriodEnd={billingDetails?.currentPeriodEnd}
                  status={billingStatus}
                />
              )}
              <div className="account-plan-grid">
                <MembershipStatus serverStatus={summary.organization.billing_status} serverPlan={summary.organization.plan_key} />
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
            </>
          )}
        </section>
      </main>
    </div>
  );
}
