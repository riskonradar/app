"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

type SavedFmeaAnalysis = {
  id: string;
  name: string;
  scope: string;
  rowCount: number;
  componentCount: number;
  includedCount: number;
  highestRpn: number;
  updatedAt: string;
  topRisks?: Array<{
    component: string;
    failureMode: string;
    rpn: number;
  }>;
};

const defaultAnalyses: SavedFmeaAnalysis[] = [
  {
    id: "turbofan-default",
    name: "Turbofan reliability FMEA",
    scope: "20 components",
    rowCount: 209,
    componentCount: 20,
    includedCount: 209,
    highestRpn: 432,
    updatedAt: "Preloaded evidence set",
    topRisks: [
      {
        component: "High-pressure turbine",
        failureMode: "Uncontained failure",
        rpn: 432,
      },
      {
        component: "High-pressure turbine",
        failureMode: "Creep",
        rpn: 392,
      },
      {
        component: "Bearing",
        failureMode: "Uncontained failure",
        rpn: 378,
      },
    ],
  },
];

function subscribeToAnalyses(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("riskonradar-fmea-analyses-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("riskonradar-fmea-analyses-change", callback);
  };
}

function getAnalysesSnapshot() {
  return window.localStorage.getItem("riskonradar-fmea-analyses");
}

function getServerAnalysesSnapshot() {
  return null;
}

function parseSavedAnalyses(saved: string | null) {
  try {
    if (!saved) return defaultAnalyses;
    const parsed = JSON.parse(saved) as SavedFmeaAnalysis[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    return defaultAnalyses;
  }
  return defaultAnalyses;
}

export function AnalysisList() {
  const analysesSnapshot = useSyncExternalStore(
    subscribeToAnalyses,
    getAnalysesSnapshot,
    getServerAnalysesSnapshot,
  );
  const analyses = useMemo(() => parseSavedAnalyses(analysesSnapshot), [analysesSnapshot]);

  function deleteAnalysis(analysis: SavedFmeaAnalysis) {
    if (analysis.id === "turbofan-default") return;
    const confirmed = window.confirm(`Delete "${analysis.name}"? This removes the saved FMEA table from this browser.`);
    if (!confirmed) return;

    const nextAnalyses = analyses.filter((item) => item.id !== analysis.id);

    if (nextAnalyses.length) {
      window.localStorage.setItem("riskonradar-fmea-analyses", JSON.stringify(nextAnalyses));
    } else {
      window.localStorage.removeItem("riskonradar-fmea-analyses");
    }

    window.localStorage.removeItem("riskonradar-fmea-data");
    window.localStorage.removeItem("riskonradar-fmea-saved-at");
    window.localStorage.removeItem("riskonradar-fmea-name");
    window.dispatchEvent(new Event("riskonradar-fmea-analyses-change"));
  }

  return (
    <div className="fmea-analysis-list">
      {analyses.map((analysis) => (
        <article key={analysis.id} className="fmea-analysis-row">
          <div className="fmea-analysis-main">
            <Link href="/fmea" className="fmea-analysis-link">
              <span>
                <strong>{analysis.name}</strong>
                <small>
                  {analysis.componentCount} component{analysis.componentCount === 1 ? "" : "s"} ·{" "}
                  {analysis.rowCount} rows · {analysis.includedCount} spreadsheet rows
                </small>
              </span>
              <span>{analysis.updatedAt}</span>
              <em>Max RPN {analysis.highestRpn || "-"}</em>
            </Link>
            {analysis.id !== "turbofan-default" && (
              <button
                type="button"
                className="fmea-analysis-delete"
                onClick={() => deleteAnalysis(analysis)}
                aria-label={`Delete ${analysis.name}`}
              >
                Delete
              </button>
            )}
          </div>
          <details className="fmea-analysis-risks">
            <summary>Top RPN items</summary>
            <div>
              {(analysis.topRisks?.length ? analysis.topRisks : []).slice(0, 3).map((risk) => (
                <p key={`${risk.component}-${risk.failureMode}-${risk.rpn}`}>
                  <span>
                    <strong>{risk.component}</strong>
                    <small>{risk.failureMode}</small>
                  </span>
                  <em>RPN {risk.rpn}</em>
                </p>
              ))}
              {!analysis.topRisks?.length && <small>No scored rows saved yet.</small>}
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}
