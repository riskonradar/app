"use client";

import { useEffect } from "react";

import { AppNav } from "@/components/app-nav";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Risk on Radar route error", error);
  }, [error]);

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main route-state-main" tabIndex={-1}>
        <section className="route-state-panel" aria-labelledby="route-error-title">
          <span className="metric-label">Workspace unavailable</span>
          <h1 id="route-error-title">We could not load this view</h1>
          <p>
            Your saved engineering data has not been changed. Try loading the view again, or return to the dashboard.
          </p>
          <div className="page-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={reset}>
              Try again
            </button>
            <a className="btn btn-secondary btn-sm" href="/dashboard">
              Return to dashboard
            </a>
          </div>
          {error.digest ? <small>Reference {error.digest}</small> : null}
        </section>
      </main>
    </div>
  );
}
