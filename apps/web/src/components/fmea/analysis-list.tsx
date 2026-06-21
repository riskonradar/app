"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

type AnalysesResponse = {
  analyses?: SavedFmeaAnalysis[];
  error?: string;
};

export function AnalysisList() {
  const [analyses, setAnalyses] = useState<SavedFmeaAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const fetchAnalyses = useCallback(async () => {
    try {
      const response = await fetch("/api/fmea/analyses", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as AnalysesResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Could not load saved analyses.");
      }
      setAnalyses(payload.analyses ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load saved analyses.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  function retryLoadAnalyses() {
    setIsLoading(true);
    setError("");
    void fetchAnalyses();
  }

  useEffect(() => {
    // Server synchronization is the point of this component; the updates happen after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAnalyses();
  }, [fetchAnalyses]);

  async function deleteAnalysis(analysis: SavedFmeaAnalysis) {
    const confirmed = window.confirm(`Delete "${analysis.name}"? This removes the saved Failure Mode and Effects Analysis table from this workspace.`);
    if (!confirmed) return;

    const previousAnalyses = analyses;
    setAnalyses((current) => current.filter((item) => item.id !== analysis.id));
    try {
      const response = await fetch(`/api/fmea/analyses/${analysis.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not delete analysis.");
      }
    } catch (deleteError) {
      setAnalyses(previousAnalyses);
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete analysis.");
    }
  }

  function startRenaming(analysis: SavedFmeaAnalysis) {
    setRenamingId(analysis.id);
    setDraftName(analysis.name);
  }

  function cancelRename() {
    setRenamingId(null);
    setDraftName("");
  }

  async function saveRename(analysis: SavedFmeaAnalysis) {
    const nextName = draftName.trim();
    if (!nextName) return;

    const previousAnalyses = analyses;
    const nextAnalyses = analyses.map((item) =>
      item.id === analysis.id ? { ...item, name: nextName } : item,
    );
    setAnalyses(nextAnalyses);

    try {
      const response = await fetch(`/api/fmea/analyses/${analysis.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not rename analysis.");
      }

      setRenamingId(null);
      setDraftName("");
    } catch (renameError) {
      setAnalyses(previousAnalyses);
      setError(renameError instanceof Error ? renameError.message : "Could not rename analysis.");
    }
  }

  if (isLoading) {
    return <p className="notice standalone">Loading saved analyses...</p>;
  }

  if (error) {
    return (
      <div className="dashboard-panel-muted">
        <p className="notice standalone error">{error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={retryLoadAnalyses}>
          Try again
        </button>
      </div>
    );
  }

  if (!analyses.length) {
    return (
      <div className="dashboard-panel-muted">
        <p className="notice standalone">No saved Failure Mode and Effects Analysis tables yet.</p>
        <Link href="/fmea?mode=new" className="btn btn-primary btn-sm">
          Create analysis
        </Link>
      </div>
    );
  }

  return (
    <div className="fmea-analysis-list">
      {analyses.map((analysis) => (
        <article key={analysis.id} className="fmea-analysis-row">
          <div className="fmea-analysis-main">
            <Link href={`/fmea?analysis=${analysis.id}`} className="fmea-analysis-link">
              <span>
                {renamingId === analysis.id ? (
                  <input
                    className="fmea-analysis-name-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onClick={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveRename(analysis);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    aria-label={`Rename ${analysis.name}`}
                    autoFocus
                  />
                ) : (
                  <strong>{analysis.name}</strong>
                )}
                <small>
                  {analysis.componentCount} component{analysis.componentCount === 1 ? "" : "s"} ·{" "}
                  {analysis.rowCount} rows · {analysis.includedCount} spreadsheet rows
                </small>
              </span>
              <span>{analysis.updatedAt}</span>
              <em>Max RPN {analysis.highestRpn || "-"}</em>
            </Link>
            <div className="fmea-analysis-actions">
              {renamingId === analysis.id ? (
                <>
                  <button
                    type="button"
                    className="fmea-analysis-action"
                    onClick={() => saveRename(analysis)}
                    disabled={!draftName.trim()}
                  >
                    Save name
                  </button>
                  <button
                    type="button"
                    className="fmea-analysis-action muted"
                    onClick={cancelRename}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="fmea-analysis-action"
                  onClick={() => startRenaming(analysis)}
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                className="fmea-analysis-delete"
                onClick={() => deleteAnalysis(analysis)}
                aria-label={`Delete ${analysis.name}`}
              >
                Delete
              </button>
            </div>
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
