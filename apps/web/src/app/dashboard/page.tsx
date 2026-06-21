import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import fmeaData from "@/data/fmea-turbofan-data.json";
import { getWorkspaceSummary } from "@/lib/account/server";
import { getBillingPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

const reviewQueues = [
  {
    label: "Evidence-backed FMEA rows",
    value: fmeaData.rowCount,
    detail: "Merged from current turbofan reliability evidence",
  },
  {
    label: "Source records",
    value: fmeaData.recordCount,
    detail: "Papers and EASA directives in the prototype corpus",
  },
  {
    label: "Components",
    value: fmeaData.components.length,
    detail: "Available in the preloaded system template",
  },
];

const nextActions = [
  {
    title: "Open FMEA workspace",
    description: "Review failure modes, evidence spans, and editable FMEA fields.",
    href: "/",
    cta: "Open workspace",
  },
  {
    title: "Set up organization",
    description: "Create a company workspace, invite teammates, and define roles.",
    href: "/account",
    cta: "Manage account",
  },
  {
    title: "Choose plan",
    description: "Individual for pilots, Team for shared review, Enterprise for SSO-led rollout.",
    href: "/pricing",
    cta: "View pricing",
  },
];

export default async function DashboardPage() {
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load dashboard workspace summary:", error);
    return null;
  });
  const plan = getBillingPlan(summary?.organization.plan_key);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main dashboard-main">
        <section className="dashboard-header">
          <div className="page-heading">
            <span className="metric-label">Dashboard</span>
            <h1>Reliability work queue</h1>
            <p>
              A calmer overview for the active workspace. Use the full FMEA workspace when you are
              ready to inspect evidence and edit rows.
            </p>
          </div>
          <div className="dashboard-context">
            <span>Active workspace</span>
            <strong>{summary?.organization.name ?? "Not signed in"}</strong>
            <small>
              {plan?.name ?? "No plan"} · {summary?.memberCount ?? 0} members
            </small>
          </div>
        </section>

        <section className="dashboard-metrics" aria-label="Workspace metrics">
          {reviewQueues.map((item) => (
            <article key={item.label} className="dashboard-metric">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </section>

        <section className="dashboard-layout">
          <div className="dashboard-panel">
            <div className="section-heading">
              <span className="metric-label">Next Actions</span>
              <h2>Keep setup and review separate</h2>
            </div>
            <div className="action-list">
              {nextActions.map((action) => (
                <Link key={action.title} href={action.href} className="action-row">
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>
                  <em>{action.cta}</em>
                </Link>
              ))}
            </div>
          </div>

          <aside className="dashboard-panel dashboard-panel-muted">
            <div className="section-heading">
              <span className="metric-label">Account Readiness</span>
              <h2>B2B setup</h2>
            </div>
            <ul className="readiness-list">
              <li data-state={summary ? "complete" : "pending"}>Signed-in user mirror</li>
              <li data-state={summary?.organization.clerk_organization_id ? "complete" : "pending"}>
                Company organization
              </li>
              <li data-state={summary?.memberCount ? "complete" : "pending"}>Membership record</li>
              <li data-state={summary?.organization.billing_status === "active" ? "complete" : "pending"}>
                Active billing entitlement
              </li>
            </ul>
          </aside>
        </section>
      </main>
    </div>
  );
}
