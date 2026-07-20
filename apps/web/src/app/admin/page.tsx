import type { Metadata } from "next";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { requireAdmin } from "@/lib/admin/gate";
import {
  getAdminDashboard,
  PAPER_CLASSIFICATION_STATUSES,
  parseAdminPaperStatus,
} from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pipeline administration",
};

type AdminPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const numberFormat = new Intl.NumberFormat("en-GB");

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatCount(value: number) {
  return numberFormat.format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function statusClass(value: string) {
  if (["completed", "classified", "finished"].includes(value)) return "is-ok";
  if (["failed", "removed"].includes(value)) return "is-danger";
  if (["running", "pending", "pending_classification", "queued", "stale"].includes(value)) {
    return "is-warning";
  }
  return "is-neutral";
}

function pageHref(page: number, status: string | null) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return `/admin?${params.toString()}`;
}

function metadataCount(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.papers_found;
  return typeof value === "number" ? formatCount(value) : "Not recorded";
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await requireAdmin();

  const params = await searchParams;
  const status = parseAdminPaperStatus(firstParam(params.status));
  const requestedPage = Number.parseInt(firstParam(params.page) ?? "1", 10);
  const dashboard = await getAdminDashboard({ page: requestedPage, status });
  const stuckOnPage = dashboard.papers.rows.filter((paper) => paper.failedJob?.stuck).length;
  const unresolvedClaimCount = dashboard.taxonomyInbox.reduce(
    (total, row) => total + Number(row.claim_count),
    0,
  );

  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main dashboard-main admin-main" tabIndex={-1}>
        <section className="dashboard-header dashboard-header-simple admin-header">
          <div className="page-heading">
            <span className="metric-label">Internal operations · Read-only</span>
            <h1>Paper pipeline</h1>
            <p>
              Discovery, classification, evidence growth, and taxonomy exceptions from the
              production knowledge pipeline.
            </p>
          </div>
          <span className="admin-live-note">Loaded on request</span>
        </section>

        <section className="admin-summary-grid" aria-label="Pipeline summary">
          <article className="dashboard-metric">
            <span>Total papers</span>
            <strong>{formatCount(dashboard.papers.total)}</strong>
            <p>{formatCount(dashboard.papers.classificationCounts.classified)} classified</p>
          </article>
          <article className="dashboard-metric">
            <span>Failed papers</span>
            <strong>{formatCount(dashboard.papers.classificationCounts.failed)}</strong>
            <p>{formatCount(dashboard.classificationJobs.counts.failed)} failed classifier jobs</p>
          </article>
          <article className="dashboard-metric">
            <span>Evidence claims</span>
            <strong>{formatCount(dashboard.evidence.claims.total)}</strong>
            <p>+{formatCount(dashboard.evidence.claims.last7Days)} in the last 7 days</p>
          </article>
          <article className="dashboard-metric">
            <span>Taxonomy queue</span>
            <strong>{formatCount(unresolvedClaimCount)}</strong>
            <p>Across the top {dashboard.taxonomyInbox.length} unresolved labels</p>
          </article>
        </section>

        <div className="admin-overview-grid">
          <section className="dashboard-panel" aria-labelledby="pipeline-status-heading">
            <div className="section-heading">
              <span className="metric-label">Current distribution</span>
              <h2 id="pipeline-status-heading">Pipeline status</h2>
            </div>
            <div className="admin-status-columns">
              <div>
                <h3>Paper classification</h3>
                <ul className="admin-status-list">
                  {Object.entries(dashboard.papers.classificationCounts).map(([label, count]) => (
                    <li key={label}>
                      <span>{label.replaceAll("_", " ")}</span>
                      <strong>{formatCount(count)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Paper lifecycle</h3>
                <ul className="admin-status-list">
                  {Object.entries(dashboard.papers.lifecycleCounts).map(([label, count]) => (
                    <li key={label}>
                      <span>{label.replaceAll("_", " ")}</span>
                      <strong>{formatCount(count)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Classifier jobs</h3>
                <ul className="admin-status-list">
                  {Object.entries(dashboard.classificationJobs.counts).map(([label, count]) => (
                    <li key={label}>
                      <span>{label.replaceAll("_", " ")}</span>
                      <strong>{formatCount(count)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="dashboard-panel" aria-labelledby="latest-run-heading">
            <div className="section-heading">
              <span className="metric-label">Discovery service</span>
              <h2 id="latest-run-heading">Most recent run</h2>
            </div>
            {dashboard.latestDiscoveryRun ? (
              <dl className="admin-detail-list">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={`admin-status-pill ${statusClass(dashboard.latestDiscoveryRun.status)}`}>
                      {dashboard.latestDiscoveryRun.status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{dashboard.latestDiscoveryRun.source}</dd>
                </div>
                <div>
                  <dt>Query</dt>
                  <dd>{dashboard.latestDiscoveryRun.query}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatDate(dashboard.latestDiscoveryRun.started_at)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatDate(dashboard.latestDiscoveryRun.finished_at)}</dd>
                </div>
                <div>
                  <dt>Papers found</dt>
                  <dd>{metadataCount(dashboard.latestDiscoveryRun.metadata)}</dd>
                </div>
              </dl>
            ) : (
              <p className="admin-empty">No discovery run has been recorded.</p>
            )}
          </section>
        </div>

        <section className="dashboard-panel admin-section" aria-labelledby="evidence-heading">
          <div className="section-heading">
            <span className="metric-label">Knowledge output</span>
            <h2 id="evidence-heading">Evidence growth</h2>
          </div>
          <div className="admin-evidence-grid">
            {Object.entries(dashboard.evidence).map(([label, metric]) => (
              <div className="admin-evidence-metric" key={label}>
                <span>{label}</span>
                <strong>{formatCount(metric.total)}</strong>
                <small>
                  +{formatCount(metric.last7Days)} / 7d · +{formatCount(metric.last30Days)} / 30d
                </small>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel admin-section" aria-labelledby="papers-heading">
          <div className="admin-table-heading">
            <div className="section-heading">
              <span className="metric-label">Candidate inventory</span>
              <h2 id="papers-heading">Papers</h2>
              <p>
                {formatCount(dashboard.papers.filteredCount)} matching records · page {dashboard.papers.page} of{" "}
                {dashboard.papers.pageCount}
                {stuckOnPage ? ` · ${stuckOnPage} stuck on this page` : ""}
              </p>
            </div>
            <form className="admin-filter" action="/admin" method="get">
              <label htmlFor="admin-status-filter">Classification status</label>
              <div>
                <select id="admin-status-filter" name="status" defaultValue={status ?? ""}>
                  <option value="">All statuses</option>
                  {PAPER_CLASSIFICATION_STATUSES.map((paperStatus) => (
                    <option value={paperStatus} key={paperStatus}>
                      {paperStatus}
                    </option>
                  ))}
                </select>
                <button type="submit">Filter</button>
              </div>
            </form>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Paper</th>
                  <th scope="col">Journal / DOI</th>
                  <th scope="col">Classification</th>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Failed job</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.papers.rows.length ? (
                  dashboard.papers.rows.map((paper) => (
                    <tr key={paper.id}>
                      <td>
                        <strong className="admin-paper-title">{paper.title}</strong>
                      </td>
                      <td>
                        <span>{paper.journal || "Unknown journal"}</span>
                        {paper.doi ? (
                          paper.doi.startsWith("10.") ? (
                            <a
                              className="admin-doi"
                              href={`https://doi.org/${paper.doi}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {paper.doi}
                            </a>
                          ) : (
                            <small className="admin-doi">{paper.doi}</small>
                          )
                        ) : (
                          <small className="admin-doi">No DOI</small>
                        )}
                      </td>
                      <td>
                        <span className={`admin-status-pill ${statusClass(paper.classificationStatus)}`}>
                          {paper.classificationStatus}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status-pill ${statusClass(paper.lifecycleStatus)}`}>
                          {paper.lifecycleStatus.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        {paper.failedJob ? (
                          <div className="admin-failure-detail">
                            <span>
                              {paper.failedJob.attempts} attempt{paper.failedJob.attempts === 1 ? "" : "s"}
                              {paper.failedJob.stuck ? (
                                <strong className="admin-stuck-label">Stuck · won&apos;t retry</strong>
                              ) : null}
                            </span>
                            <small>{paper.failedJob.classifierVersion}</small>
                            <p title={paper.failedJob.lastError ?? undefined}>
                              {paper.failedJob.lastError || "No error message recorded"}
                            </p>
                          </div>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                      <td>
                        <time dateTime={paper.updatedAt}>{formatDate(paper.updatedAt)}</time>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="admin-empty-cell">
                      No papers match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <nav className="admin-pagination" aria-label="Paper table pagination">
            {dashboard.papers.page > 1 ? (
              <Link href={pageHref(dashboard.papers.page - 1, status)}>Previous</Link>
            ) : (
              <span aria-disabled="true">Previous</span>
            )}
            <strong>
              {dashboard.papers.page} / {dashboard.papers.pageCount}
            </strong>
            {dashboard.papers.page < dashboard.papers.pageCount ? (
              <Link href={pageHref(dashboard.papers.page + 1, status)}>Next</Link>
            ) : (
              <span aria-disabled="true">Next</span>
            )}
          </nav>
        </section>

        <section className="dashboard-panel admin-section" aria-labelledby="taxonomy-heading">
          <div className="section-heading">
            <span className="metric-label">Human curation queue</span>
            <h2 id="taxonomy-heading">Unresolved taxonomy labels</h2>
            <p>Top 20 unlinked component and failure-mode labels by claim count.</p>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-taxonomy-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Label</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Papers</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.taxonomyInbox.length ? (
                  dashboard.taxonomyInbox.map((row) => (
                    <tr key={`${row.claim_type}:${row.label}`}>
                      <td>{row.claim_type.replaceAll("_", " ")}</td>
                      <td><strong>{row.label}</strong></td>
                      <td>{formatCount(Number(row.claim_count))}</td>
                      <td>{formatCount(Number(row.paper_count))}</td>
                      <td><time dateTime={row.last_seen_at}>{formatDate(row.last_seen_at)}</time></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="admin-empty-cell">No unresolved taxonomy labels.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
