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
  if (typeof window === "undefined") return defaultAnalyses;
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
  const [analyses] = useState<SavedFmeaAnalysis[]>(readSavedAnalyses);

  return (
    <div className="fmea-analysis-list">
      {analyses.map((analysis) => (
        <article key={analysis.id} className="fmea-analysis-row">
          <Link href="/fmea" className="fmea-analysis-main">
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
