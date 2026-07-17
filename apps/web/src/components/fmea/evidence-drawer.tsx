"use client";

import { useMemo } from "react";

import type { EvidenceReference, FmeaRow, Source } from "@/lib/fmea/types";
import { displaySafeEvidence } from "@/lib/fmea/worksheet";

type EvidenceDrawerProps = {
  row: FmeaRow;
  onClose: () => void;
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

export function EvidenceDrawer({ row, onClose }: EvidenceDrawerProps) {
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

  return (
    <div className="source-dialog-backdrop evidence-drawer-backdrop" role="presentation" onClick={onClose}>
      <section
        className="source-dialog evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Evidence and citations"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" type="button" aria-label="Close evidence" onClick={onClose}>
          ×
        </button>
        <span className="metric-label">Evidence lineage</span>
        <h3>{row.component} · {row.failureMode}</h3>
        <p>Machine-extracted evidence remains review-required until an engineer accepts this row.</p>

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

                {evidence.length ? evidence.map((reference) => (
                  <article className="evidence-claim" key={`${reference.field}:${reference.claimId}`}>
                    <div className="evidence-claim-meta">
                      <strong>{fieldLabel(reference.field)}</strong>
                      <span>{reference.confidence == null ? "Confidence unavailable" : `${Math.round(reference.confidence * 100)}% confidence`}</span>
                      <span>{reference.supportType.replace(/_/g, " ")}</span>
                    </div>
                    <p>{reference.value}</p>
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
                    <code className="evidence-claim-id">Claim {reference.claimId}</code>
                  </article>
                )) : (
                  <span className="evidence-span-empty">This legacy source has no field-level claim lineage.</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No evidence lineage is attached to this row.</p>
        )}
      </section>
    </div>
  );
}
