import { currentUser } from "@clerk/nextjs/server";
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
    title: "Test Mollie checkout",
    description: "Open the signed-in demo buying flow for one user.",
    href: "/pricing",
    cta: "Open checkout",
  },
  {
    title: "Manage account",
    description: "Confirm the signed-in personal demo workspace.",
    href: "/account",
    cta: "Open account",
  },
];

function numericRpn(row: (typeof fmeaData.rows)[number]) {
  const explicit = Number(row.rpn);
  if (explicit) return explicit;
  const severity = Number(row.severity);
  const occurrence = Number(row.occurrence);
  const detection = Number(row.detection);
  return severity && occurrence && detection ? severity * occurrence * detection : 0;
}

const activeFmeaItems = [...fmeaData.rows]
  .sort((a, b) => numericRpn(b) - numericRpn(a) || b.evidenceCount - a.evidenceCount)
  .slice(0, 8);

export default async function DashboardPage() {
  const user = await currentUser().catch(() => null);
  const summary = await getWorkspaceSummary().catch((error) => {
    console.error("Failed to load dashboard workspace summary:", error);
    return null;
  });
  const plan = getBillingPlan(summary?.organization.plan_key);
  const workspaceName =
    summary?.organization.name ??
    (user ? `${user.firstName || user.emailAddresses[0]?.emailAddress || "Personal"} workspace` : "Not signed in");
  const memberCount = summary?.memberCount ?? (user ? 1 : 0);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main dashboard-main">
        <section className="dashboard-header">
          <div className="page-heading">
            <span className="metric-label">Dashboard</span>
            <h1>Current FMEA work</h1>
            <p>
              A list of the active FMEA rows currently being reviewed. Open the workspace to inspect
              evidence, edit fields, and export the spreadsheet.
            </p>
          </div>
          <div className="dashboard-context">
            <span>Active workspace</span>
            <strong>{workspaceName}</strong>
            <small>
              {plan?.name ?? (user ? "Demo checkout" : "No plan")} · {memberCount} member{memberCount === 1 ? "" : "s"}
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
              <span className="metric-label">FMEA rows in progress</span>
              <h2>Highest-priority review queue</h2>
            </div>
            <div className="fmea-work-list">
              {activeFmeaItems.map((row) => (
                <Link
                  key={`${row.component}-${row.failureMode}-${row.effect}`}
                  href="/"
                  className="fmea-work-row"
                >
                  <span>
                    <strong>{row.component}</strong>
                    <small>{row.failureMode}</small>
                  </span>
                  <span>{row.effect || "Effect needs review"}</span>
                  <em>RPN {numericRpn(row) || "-"}</em>
                </Link>
              ))}
            </div>
          </div>

          <aside className="dashboard-panel dashboard-panel-muted">
            <div className="section-heading">
              <span className="metric-label">Demo flow</span>
              <h2>Checkout and review</h2>
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
          </aside>
        </section>
      </main>
    </div>
  );
}
