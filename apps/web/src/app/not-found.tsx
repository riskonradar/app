import type { Metadata } from "next";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main route-state-main" tabIndex={-1}>
        <section className="route-state-panel" aria-labelledby="not-found-title">
          <span className="metric-label">Page not found</span>
          <h1 id="not-found-title">This workspace view does not exist</h1>
          <p>Check the address, or continue from your saved Failure Mode and Effects Analysis tables.</p>
          <div className="page-actions">
            <Link className="btn btn-primary btn-sm" href="/dashboard">
              Open dashboard
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
