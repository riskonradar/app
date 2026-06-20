"use client";

import { useMemo, useState } from "react";
import fmeaData from "@/data/fmea-turbofan-data.json";

type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
};

type FmeaRow = {
  component: string;
  failureMode: string;
  effect: string;
  cause: string;
  severity: string;
  occurrence: string;
  detection: string;
  correctiveAction: string;
  rpn: string;
  evidenceCount: number;
  sources: Source[];
};

const SYSTEM_COMPONENTS = [
  "Engine inlet / intake",
  "Fan / fan blade",
  "Fan case",
  "Low-pressure compressor",
  "High-pressure compressor",
  "Combustor",
  "High-pressure turbine",
  "Low-pressure turbine",
  "Shaft",
  "Bearing",
  "Gearbox / accessory gearbox",
];

function splitTerms(value: string) {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function TermCell({ value }: { value: string }) {
  const terms = splitTerms(value);
  if (!terms.length) return <span className="blank">blank</span>;
  if (terms.length === 1) return <>{terms[0]}</>;
  return (
    <div className="term-list">
      {terms.map((term) => (
        <span key={term}>{term}</span>
      ))}
    </div>
  );
}

function sourceId(source: Source) {
  return [source.doi, source.title, source.year].filter(Boolean).join("|");
}

export default function Home() {
  const [query, setQuery] = useState("turbofan engine");
  const [activeComponent, setActiveComponent] = useState("All");
  const [coverage, setCoverage] = useState("all");
  const [selectedRow, setSelectedRow] = useState<FmeaRow | null>(null);

  const rows = fmeaData.rows as FmeaRow[];
  const systemMatches =
    !query.trim() ||
    fmeaData.system.toLowerCase().includes(query.toLowerCase()) ||
    query.toLowerCase().includes("turbofan") ||
    query.toLowerCase().includes("engine");

  const componentCounts = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    rows.forEach((row) => {
      if (!sets.has(row.component)) sets.set(row.component, new Set());
      row.sources.forEach((source) => sets.get(row.component)?.add(sourceId(source)));
    });
    return [...sets.entries()]
      .map(([component, sources]) => ({ component, count: sources.size }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return fmeaData.components.indexOf(a.component) - fmeaData.components.indexOf(b.component);
      });
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!systemMatches) return [];
    const componentOrder = componentCounts.map((item) => item.component);
    return rows
      .filter((row) => {
        if (activeComponent !== "All" && row.component !== activeComponent) return false;
        if (coverage === "effect" && !row.effect) return false;
        if (coverage === "cause" && !row.cause) return false;
        return true;
      })
      .sort((a, b) => {
        const componentDelta = componentOrder.indexOf(a.component) - componentOrder.indexOf(b.component);
        if (componentDelta !== 0) return componentDelta;
        if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount;
        return a.failureMode.localeCompare(b.failureMode);
      });
  }, [activeComponent, componentCounts, coverage, rows, systemMatches]);

  let previousComponent = "";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://riskonradar.com/">
          r<span>ı</span>sk on radar<span>.</span>
        </a>
        <nav className="topnav" aria-label="Product navigation">
          <a href="#classifier">FMEA classifier</a>
          <a href="#fmea-table">Worksheet</a>
        </nav>
      </header>

      <section id="classifier" className="workspace-shell">
        <div className="workspace-header">
          <p className="eyebrow">Evidence-backed FMEA classifier</p>
          <div className="source-card" aria-live="polite">
            <span className="source-label">Dataset</span>
            <strong>{fmeaData.system}</strong>
            <small>
              {fmeaData.rowCount} extracted rows · {fmeaData.recordCount} RIS records
            </small>
          </div>
        </div>

        <div className="search-panel">
          <label htmlFor="system-search">System name</label>
          <div className="search-row">
            <span aria-hidden="true">⌕</span>
            <input
              id="system-search"
              type="search"
              value={query}
              placeholder="Search a system, e.g. turbofan engine"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveComponent("All");
              }}
            />
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              ×
            </button>
          </div>
          <p className="hint">
            {systemMatches
              ? "Prototype classifier dataset: Turbofan engine."
              : "No system in this prototype matches that search yet."}
          </p>
        </div>

        <section className="system-map" aria-label="Turbofan component interaction map">
          <div className="map-head">
            <div>
              <p className="eyebrow">System map</p>
              <h2>Component interaction path</h2>
            </div>
          </div>
          <div className="map-flow">
            {SYSTEM_COMPONENTS.map((component) => {
              const count = componentCounts.find((item) => item.component === component)?.count ?? 0;
              return (
                <button
                  className={`map-node ${activeComponent === component ? "active" : ""} ${
                    activeComponent !== "All" && activeComponent !== component ? "muted" : ""
                  }`}
                  key={component}
                  type="button"
                  title={`${component}: ${count} evidence papers`}
                  onClick={() => setActiveComponent(activeComponent === component ? "All" : component)}
                >
                  <span>{component}</span>
                  <small>{count || ""}</small>
                </button>
              );
            })}
          </div>
        </section>

        <section className="content-grid">
          <aside className="component-panel" aria-label="Components">
            <div className="panel-head">
              <h2>Components</h2>
              <span>{activeComponent}</span>
            </div>
            <div className="component-list">
              <button
                className={`component-button ${activeComponent === "All" ? "active" : ""}`}
                type="button"
                onClick={() => setActiveComponent("All")}
              >
                <span>All components</span>
                <span>{componentCounts.reduce((total, item) => total + item.count, 0)} papers</span>
              </button>
              {componentCounts.map(({ component, count }) => (
                <button
                  className={`component-button ${activeComponent === component ? "active" : ""}`}
                  key={component}
                  type="button"
                  onClick={() => setActiveComponent(component)}
                >
                  <span>{component}</span>
                  <span>{count}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="table-panel" aria-labelledby="table-title">
            <div className="table-toolbar">
              <div>
                <p className="eyebrow">Generated FMEA worksheet</p>
                <h2 id="table-title">Failure modes, effects, and causes</h2>
              </div>
              <select value={coverage} onChange={(event) => setCoverage(event.target.value)}>
                <option value="all">All evidence rows</option>
                <option value="effect">Has effect</option>
                <option value="cause">Has cause</option>
              </select>
            </div>

            <div className="table-wrap">
              <table id="fmea-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Failure mode</th>
                    <th>Effect</th>
                    <th>Cause</th>
                    <th>S</th>
                    <th>O</th>
                    <th>D</th>
                    <th>Corrective action</th>
                    <th>RPN</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const repeated = previousComponent === row.component;
                    previousComponent = row.component;
                    return (
                      <tr key={`${row.component}-${row.failureMode}`}>
                        <td className={repeated ? "component-repeat" : "component-start"}>
                          {repeated ? "" : row.component}
                        </td>
                        <td>{row.failureMode}</td>
                        <td><TermCell value={row.effect} /></td>
                        <td><TermCell value={row.cause} /></td>
                        <td className="score-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td className="action-cell blank">blank</td>
                        <td className="score-cell blank">blank</td>
                        <td>
                          <button className="evidence-button" type="button" onClick={() => setSelectedRow(row)}>
                            {row.evidenceCount} paper{row.evidenceCount === 1 ? "" : "s"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filteredRows.length && <p className="empty-state">No extracted rows match this view.</p>}
          </section>
        </section>
      </section>

      {selectedRow && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setSelectedRow(null)}>
          <section className="source-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setSelectedRow(null)}>
              ×
            </button>
            <p className="eyebrow">Evidence for row</p>
            <h3>{selectedRow.component} · {selectedRow.failureMode}</h3>
            <p className="hint">Structured classifier output remains review-required engineering evidence.</p>
            <ul className="source-list">
              {selectedRow.sources.map((source) => (
                <li key={sourceId(source)}>
                  <strong>{source.title}</strong>
                  <span>
                    {source.doi ? `DOI: ${source.doi}` : source.url || "RIS source record"}
                    {source.year ? ` · ${source.year}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
