"use client";

import Link from "next/link";
import { useState } from "react";

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

function readSavedAnalyses() {
  try {
    const saved = window.localStorage.getItem("riskonradar-fmea-analyses");
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
  const [analyses, setAnalyses] = useState<SavedFmeaAnalysis[]>(() =>
    typeof window === "undefined" ? defaultAnalyses : readSavedAnalyses(),
  );

  function deleteAnalysis(analysis: SavedFmeaAnalysis) {
    if (analysis.id === "turbofan-default") return;
    const confirmed = window.confirm(`Delete "${analysis.name}"? This removes the saved FMEA table from this browser.`);
    if (!confirmed) return;

    const nextAnalyses = analyses.filter((item) => item.id !== analysis.id);
    setAnalyses(nextAnalyses.length ? nextAnalyses : defaultAnalyses);

    if (nextAnalyses.length) {
      window.localStorage.setItem("riskonradar-fmea-analyses", JSON.stringify(nextAnalyses));
    } else {
      window.localStorage.removeItem("riskonradar-fmea-analyses");
    }

    window.localStorage.removeItem("riskonradar-fmea-data");
    window.localStorage.removeItem("riskonradar-fmea-saved-at");
    window.localStorage.removeItem("riskonradar-fmea-name");
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
