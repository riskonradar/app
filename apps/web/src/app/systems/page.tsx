import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { SystemModelWorkspace } from "@/components/systems/system-model-workspace";
import { getSystemModelWorkspace } from "@/lib/systems/server";

export const dynamic = "force-dynamic";

export default async function SystemsPage() {
  const workspace = await getSystemModelWorkspace();
  if (!workspace) redirect("/sign-in?redirect_url=/systems");

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main systems-main">
        <section className="dashboard-header dashboard-header-simple systems-header">
          <div className="page-heading">
            <span className="metric-label">System-level reliability analysis</span>
            <h1>Asset structure and failure propagation</h1>
            <p>
              Model component instances, engineering interfaces, and review-controlled cascade paths
              for {workspace.workspaceName}.
            </p>
          </div>
        </section>
        <SystemModelWorkspace initialWorkspace={workspace} />
      </main>
    </div>
  );
}
