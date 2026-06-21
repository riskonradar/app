"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AppNav } from "@/components/app-nav";

function BillingFailedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "The payment was not completed.";

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main billing-result-main">
        <section className="billing-result-panel billing-result-failed" aria-labelledby="payment-failed-title">
          <div className="billing-result-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </div>

          <div className="billing-result-copy">
            <span className="metric-label">Payment failed</span>
            <h1 id="payment-failed-title">Payment was not completed</h1>
            <p>{reason}</p>
          </div>

          <dl className="billing-result-summary">
            <div>
              <dt>Plan</dt>
              <dd>Free tier remains active</dd>
            </div>
            <div>
              <dt>Analysis availability</dt>
              <dd>1 saved Failure Mode and Effects Analysis table</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd>Retry checkout or review account settings</dd>
            </div>
          </dl>

          <div className="page-actions">
            <Link href="/pricing" className="btn btn-primary btn-sm">
              Try again
            </Link>
            <Link href="/account" className="btn btn-secondary btn-sm">
              Account management
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function BillingFailedPage() {
  return (
    <Suspense
      fallback={
        <div className="app-shell">
          <AppNav />
          <main className="app-main billing-result-main">
            <section className="billing-result-panel">
              <p className="notice">Loading payment result...</p>
            </section>
          </main>
        </div>
      }
    >
      <BillingFailedContent />
    </Suspense>
  );
}
