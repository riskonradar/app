import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import fmeaData from "@/data/fmea-turbofan-data.json";

const projects = [
  {
    name: "Turbofan engine FMEA",
    status: "Draft",
    rows: fmeaData.rowCount,
    updated: "Today",
    source: "Evidence corpus + EASA",
  },
  {
    name: "Imported BOM worksheet",
    status: "Local draft",
    rows: "After upload",
    updated: "Not saved",
    source: "User BOM",
  },
];

export default function DashboardPage() {
  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main">
        <section className="page-card">
          <div className="page-heading">
            <span className="metric-label">Dashboard</span>
            <h1>Current reliability projects</h1>
            <p>
              Track FMEA worksheets, imported BOM drafts, review state, and evidence-backed exports.
            </p>
          </div>

          <div className="project-list">
            {projects.map((project) => (
              <article className="project-row" key={project.name}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.source}</span>
                </div>
                <div>
                  <small>Status</small>
                  <span>{project.status}</span>
                </div>
                <div>
                  <small>Rows</small>
                  <span>{project.rows}</span>
                </div>
                <div>
                  <small>Updated</small>
                  <span>{project.updated}</span>
                </div>
              </article>
            ))}
          </div>

          <div className="page-actions">
            <Link href="/" className="btn btn-primary btn-sm">
              Open worksheet
            </Link>
            <Link href="/pricing" className="btn btn-secondary btn-sm">
              View pricing
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
