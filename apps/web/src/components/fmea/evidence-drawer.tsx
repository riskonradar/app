"use client";

import { useId, useMemo, useState } from "react";

import { ModalDialog } from "@/components/ui/modal-dialog";
import type { EvidenceReference, FmeaRow, Source } from "@/lib/fmea/types";
import { displaySafeEvidence } from "@/lib/fmea/worksheet";

type EvidenceReviewStatus = "accepted" | "rejected" | "needs_review";

type EvidenceDrawerProps = {
  row: FmeaRow;
  onClose: () => void;
  onReviewClaim?: (claimId: string, status: EvidenceReviewStatus) => Promise<void>;
};

function sourceKey(source: Source) {
  return source.doi || source.url || source.title;
}

function sourceLabel(source: Source) {
  if (source.doi) return `DOI: ${source.doi}`;
  if (source.url) return source.url;
  return source.category ? source.category.replace(/_/g, " ") : "Source record";
}

function fieldLabel(field: EvidenceReference["field"]) {
  return field.replace(/_/g, " ");
}

export function EvidenceDrawer({ row, onClose, onReviewClaim }: EvidenceDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, EvidenceReviewStatus>>({});
  const sources = useMemo(() => {
    const grouped = new Map<string, { source: Source; evidence: EvidenceReference[] }>();
    for (const reference of displaySafeEvidence(row.evidence)) {
      const key = sourceKey(reference.source);
      const entry = grouped.get(key) ?? { source: reference.source, evidence: [] };
      entry.evidence.push(reference);
      grouped.set(key, entry);
    }
    for (const source of row.sources) {
      const key = sourceKey(source);
      if (!grouped.has(key)) grouped.set(key, { source, evidence: [] });
    }
    return [...grouped.values()];
  }, [row.evidence, row.sources]);

  async function reviewClaim(claimId: string, status: EvidenceReviewStatus) {
    if (!onReviewClaim) return;
    setPendingClaimId(claimId);
    setReviewError("");
    try {
      await onReviewClaim(claimId, status);
      setReviewOverrides((current) => ({ ...current, [claimId]: status }));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Could not update the evidence review status.");
    } finally {
      setPendingClaimId(null);
    }
  }

  return (
    <ModalDialog
      className="evidence-drawer"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      closeLabel="Close evidence"
      onClose={onClose}
    >
        <span className="metric-label">Evidence lineage</span>
        <h2 id={titleId}>{row.component} · {row.failureMode}</h2>
        <p id={descriptionId}>Machine-extracted evidence remains review-required until an engineer accepts this row.</p>

        <dl className="evidence-drawer-summary">
          <div><dt>Claims</dt><dd>{row.evidence.length}</dd></div>
          <div><dt>Sources</dt><dd>{sources.length}</dd></div>
          <div><dt>Status</dt><dd>{row.status.replace(/_/g, " ")}</dd></div>
        </dl>

        {sources.length ? (
          <ul className="source-list evidence-source-list">
            {sources.map(({ source, evidence }) => (
              <li key={sourceKey(source)}>
                <div className="evidence-source-heading">
                  <strong>{source.title}</strong>
                  <span>{source.year ? `${source.year} · ` : ""}{source.category?.replace(/_/g, " ")}</span>
                  {source.url || source.doi ? (
                    <a href={source.url || `https://doi.org/${source.doi}`} target="_blank" rel="noopener noreferrer">
                      {sourceLabel(source)}
                    </a>
                  ) : (
                    <span>{sourceLabel(source)}</span>
                  )}
                </div>

                {evidence.length ? evidence.map((reference) => {
                  const reviewStatus = reviewOverrides[reference.claimId] ?? reference.reviewStatus;
                  const isPending = pendingClaimId === reference.claimId;
                  return (
                  <article className="evidence-claim" key={`${reference.field}:${reference.claimId}`}>
                    <div className="evidence-claim-meta">
                      <strong>{fieldLabel(reference.field)}</strong>
                      <span>{reference.confidence == null ? "Confidence unavailable" : `${Math.round(reference.confidence * 100)}% confidence`}</span>
                      <span>{reference.supportType.replace(/_/g, " ")}</span>
                      <span>Review: {reviewStatus.replace(/_/g, " ")}</span>
                    </div>
                    <p>{reference.value}</p>
                    {reference.inferenceRationale ? (
                      <div className="evidence-inference">
                        <strong>Inference rationale</strong>
                        <p>{reference.inferenceRationale}</p>
                      </div>
                    ) : null}
                    {reference.spans.length ? reference.spans.map((span) => (
                      <blockquote key={span.id}>
                        {span.text}
                        <cite>
                          {span.sourceField} · characters {span.charStart ?? "?"}–{span.charEnd ?? "?"}
                        </cite>
                      </blockquote>
                    )) : (
                      <span className="evidence-span-empty">No displayable exact span is attached to this claim.</span>
                    )}
                    {(reference.classifierVersion || reference.llmProvider || reference.llmModel) ? (
                      <dl className="evidence-model-lineage">
                        {reference.classifierVersion ? <div><dt>Classifier</dt><dd>{reference.classifierVersion}</dd></div> : null}
                        {reference.llmProvider ? <div><dt>Provider</dt><dd>{reference.llmProvider}</dd></div> : null}
                        {reference.llmModel ? <div><dt>Model</dt><dd>{reference.llmModel}</dd></div> : null}
                      </dl>
                    ) : null}
                    <code className="evidence-claim-id">Claim {reference.claimId}</code>
                    {onReviewClaim ? (
                      <div className="evidence-review-actions" aria-label={`Review ${fieldLabel(reference.field)} claim`}>
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={isPending || reviewStatus === "accepted"}
                          onClick={() => void reviewClaim(reference.claimId, "accepted")}
                        >
                          {isPending ? "Updating…" : "Accept claim"}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm danger-action"
                          type="button"
                          disabled={isPending || reviewStatus === "rejected"}
                          onClick={() => void reviewClaim(reference.claimId, "rejected")}
                        >
                          Reject claim
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={isPending || reviewStatus === "needs_review"}
                          onClick={() => void reviewClaim(reference.claimId, "needs_review")}
                        >
                          Reset review
                        </button>
                      </div>
                    ) : null}
                  </article>
                  );
                }) : (
                  <span className="evidence-span-empty">This legacy source has no field-level claim lineage.</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No evidence lineage is attached to this row.</p>
        )}
        {reviewError ? <p className="notice standalone error" role="alert">{reviewError}</p> : null}
    </ModalDialog>
  );
}
