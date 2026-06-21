"use client";

import Link from "next/link";
import { useEffect } from "react";

import { AppNav } from "@/components/app-nav";

export default function BillingSuccessPage() {
  useEffect(() => {
    window.localStorage.setItem(
      "riskonradar-membership",
      JSON.stringify({
        planKey: "individual",
        status: "paid",
        paidAt: new Date().toISOString(),
      }),
    );
    window.dispatchEvent(new Event("riskonradar-membership-change"));
  }, []);

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
            <span className="metric-label">Payment complete</span>
            <h1 id="payment-success-title">You are now a Pro member</h1>
            <p>
              Your account is upgraded for this workspace. Unlimited FMEA tables are available.
            </p>
          </div>

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
