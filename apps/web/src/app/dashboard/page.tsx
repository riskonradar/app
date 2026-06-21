import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { AnalysisList } from "@/components/fmea/analysis-list";
import { getWorkspaceSummary } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser().catch(() => null);
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load dashboard workspace summary:", error);
    return null;
  });
  const workspaceName =
    summary?.organization.name ??
    (user ? `${user.firstName || user.emailAddresses[0]?.emailAddress || "Personal"} workspace` : "Not signed in");
  const memberCount = summary?.memberCount ?? (user ? 1 : 0);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main dashboard-main">
        <section className="dashboard-header dashboard-header-simple">
          <div className="page-heading">
            <span className="metric-label">Failure Mode and Effects Analysis workspace</span>
            <h1>Your Failure Mode and Effects Analysis tables</h1>
            <p>
              Edit saved Failure Mode and Effects Analysis tables, add components, review the highest RPN items, and export
              the rows marked for the spreadsheet.
            </p>
            <small className="dashboard-workspace-note">
              {workspaceName} · {memberCount} member{memberCount === 1 ? "" : "s"}
            </small>
          </div>
          <Link href="/fmea?mode=new" className="dashboard-new-fmea" aria-label="Create new Failure Mode and Effects Analysis table">
            <span aria-hidden="true">+</span>
            New analysis
          </Link>
        </section>

        <section className="dashboard-panel dashboard-analysis-panel">
          <div className="section-heading">
            <span className="metric-label">Saved Failure Mode and Effects Analysis tables</span>
            <h2>Open an analysis to continue editing</h2>
          </div>
          <AnalysisList />
        </section>
      </main>
    </div>
  );
}
