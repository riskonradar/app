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
  const [loadError, setLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

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
      setLoadError(loadError instanceof Error ? loadError.message : "Could not load saved analyses.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  function retryLoadAnalyses() {
    setIsLoading(true);
    setLoadError("");
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
    setMutationError("");
    setPendingAction(`delete:${analysis.id}`);
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
      setMutationError(deleteError instanceof Error ? deleteError.message : "Could not delete analysis.");
    } finally {
      setPendingAction(null);
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
    setMutationError("");
    setPendingAction(`rename:${analysis.id}`);

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
      setMutationError(renameError instanceof Error ? renameError.message : "Could not rename analysis.");
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading) {
    return (
      <div className="analysis-list-skeleton" role="status" aria-live="polite">
        <span className="visually-hidden">Loading saved analyses</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="dashboard-panel-muted">
        <p className="notice standalone error" role="alert">{loadError}</p>
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
    <div className="fmea-analysis-list" aria-busy={pendingAction !== null}>
      {mutationError ? (
        <p className="notice standalone error" role="alert">
          {mutationError} Your saved data was not changed.
        </p>
      ) : null}
      {analyses.map((analysis) => (
        <article key={analysis.id} className="fmea-analysis-row">
          <div className="fmea-analysis-main">
            <div className="fmea-analysis-link">
              <span>
                {renamingId === analysis.id ? (
                  <input
                    className="fmea-analysis-name-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
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
                  <Link href={`/fmea?analysis=${analysis.id}`} className="fmea-analysis-open">
                    <strong>{analysis.name}</strong>
                  </Link>
                )}
                <small>
                  {analysis.componentCount} component{analysis.componentCount === 1 ? "" : "s"} ·{" "}
                  {analysis.rowCount} rows · {analysis.includedCount} spreadsheet rows
                </small>
              </span>
              <span>{analysis.updatedAt}</span>
              <em>Max RPN {analysis.highestRpn || "-"}</em>
            </div>
            <div className="fmea-analysis-actions">
              {renamingId === analysis.id ? (
                <>
                  <button
                    type="button"
                    className="fmea-analysis-action"
                    onClick={() => saveRename(analysis)}
                    disabled={!draftName.trim() || pendingAction === `rename:${analysis.id}`}
                  >
                    {pendingAction === `rename:${analysis.id}` ? "Saving" : "Save name"}
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
                  disabled={pendingAction !== null}
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                className="fmea-analysis-delete"
                onClick={() => deleteAnalysis(analysis)}
                aria-label={`Delete ${analysis.name}`}
                disabled={pendingAction !== null}
              >
                {pendingAction === `delete:${analysis.id}` ? "Deleting" : "Delete"}
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
