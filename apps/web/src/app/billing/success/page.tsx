import type { Metadata } from "next";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { getWorkspaceSummary } from "@/lib/account/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Payment status",
};

export default async function BillingSuccessPage() {
  const summaryResult = await getWorkspaceSummary()
    .then((summary) => ({ summary, failed: false }))
    .catch((error) => {
      console.error("Failed to load billing success workspace summary:", error);
      return { summary: null, failed: true };
    });
  const { summary } = summaryResult;
  const billingStatus = summary?.organization.billing_status ?? "unknown";
  const isPro = billingStatus === "active" || billingStatus === "comped";
  const statusVerified = Boolean(summary) && !summaryResult.failed;

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main billing-result-main" tabIndex={-1}>
        <section className="billing-result-panel billing-result-success" aria-labelledby="payment-success-title">
          <div className="billing-result-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <div className="billing-result-copy">
            <span className="metric-label">{isPro ? "Payment complete" : "Payment status"}</span>
            <h1 id="payment-success-title">
              {isPro
                ? "You are now a Pro member"
                : statusVerified
                  ? "Payment received, plan update pending"
                  : "Payment returned, verification unavailable"}
            </h1>
            <p>
              {isPro
                ? "Your workspace is upgraded. Unlimited Failure Mode and Effects Analysis tables are available in the dashboard and account management views."
                : statusVerified
                  ? "Your checkout return was received, but this workspace is not marked Pro yet. Refresh account status after Stripe finishes processing the subscription."
                  : "We could not load a verified workspace status. No plan is being assumed; open Account to check again before relying on paid access."}
            </p>
          </div>

          <dl className="billing-result-summary">
            <div>
              <dt>Plan status</dt>
              <dd>{statusVerified ? (isPro ? "Pro active" : billingStatus) : "Not verified"}</dd>
            </div>
            <div>
              <dt>Analysis availability</dt>
              <dd>{statusVerified ? (isPro ? "Unlimited saved tables" : "Current plan limits") : "Check Account"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{summary?.organization.name ?? "Not verified"}</dd>
            </div>
          </dl>

          <div className="page-actions">
            <Link href="/dashboard" className="btn btn-primary btn-sm">
              Go to Dashboard
            </Link>
            <Link href="/account" className="btn btn-secondary btn-sm">
              View account
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
