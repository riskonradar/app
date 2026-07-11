import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { getWorkspaceSummary } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export default async function BillingSuccessPage() {
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load billing success workspace summary:", error);
    return null;
  });
  const billingStatus = summary?.organization.billing_status ?? "free";
  const isPro = billingStatus === "active" || billingStatus === "comped";

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main billing-result-main">
        <section className="billing-result-panel billing-result-success" aria-labelledby="payment-success-title">
          <div className="billing-result-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>

          <div className="billing-result-copy">
            <span className="metric-label">{isPro ? "Payment complete" : "Payment status"}</span>
            <h1 id="payment-success-title">
              {isPro ? "You are now a Pro member" : "Payment received, plan update pending"}
            </h1>
            <p>
              {isPro
                ? "Your workspace is upgraded. Unlimited Failure Mode and Effects Analysis tables are available in the dashboard and account management views."
                : "Your checkout return was received, but this workspace is not marked Pro yet. Refresh account status after Stripe finishes processing the subscription."}
            </p>
          </div>

          <dl className="billing-result-summary">
            <div>
              <dt>Plan status</dt>
              <dd>{isPro ? "Pro active" : billingStatus}</dd>
            </div>
            <div>
              <dt>Analysis availability</dt>
              <dd>{isPro ? "Unlimited saved tables" : "1 saved table"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{summary?.organization.name ?? "Not signed in"}</dd>
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
