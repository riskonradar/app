import { AppNav } from "@/components/app-nav";

export default function Loading() {
  return (
    <div className="app-shell">
      <AppNav />
      <main id="main-content" className="app-main route-state-main" aria-busy="true">
        <section className="route-state-panel" aria-labelledby="loading-title">
          <div className="route-state-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1 id="loading-title" className="visually-hidden">Loading Risk on Radar</h1>
          <p className="visually-hidden" role="status">Loading the engineering workspace.</p>
        </section>
      </main>
    </div>
  );
}
