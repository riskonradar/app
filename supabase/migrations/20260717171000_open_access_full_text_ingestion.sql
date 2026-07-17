-- Auditable, license-gated open-access full-text ingestion.
-- The PDF bytes are hashed but not retained; only bounded extracted text is stored.
-- Application users have no direct table access. Evidence spans retain a nullable
-- FK to the exact full-text retrieval record that supplied their offsets.

CREATE TABLE papers_raw.paper_full_texts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_candidate_id uuid NOT NULL
    REFERENCES papers_raw.paper_candidates(id) ON DELETE CASCADE,
  source_url         text NOT NULL,
  resolved_url       text,
  oa_status          text,
  license            text,
  license_url        text,
  retrieval_status   text NOT NULL,
  rejection_reason   text,
  http_status        integer,
  content_type       text,
  content_bytes      bigint,
  content_sha256     text,
  extracted_text     text,
  extraction_method  text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_full_texts_status_check
    CHECK (retrieval_status IN ('fetched', 'rejected', 'failed')),
  CONSTRAINT paper_full_texts_http_status_check
    CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT paper_full_texts_content_bytes_check
    CHECK (
      content_bytes IS NULL
      OR (
        content_bytes >= 0
        AND (retrieval_status != 'fetched' OR content_bytes <= 20971520)
      )
    ),
  CONSTRAINT paper_full_texts_sha256_check
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT paper_full_texts_fetched_payload_check CHECK (
    retrieval_status != 'fetched'
    OR (
      resolved_url IS NOT NULL
      AND resolved_url LIKE 'https://%'
      AND content_type = 'application/pdf'
      AND content_bytes IS NOT NULL
      AND content_sha256 IS NOT NULL
      AND extracted_text IS NOT NULL
      AND length(extracted_text) >= 100
      AND length(extracted_text) <= 300000
      AND extraction_method = 'pypdf'
      AND license IS NOT NULL
      AND lower(replace(license, '_', '-')) IN (
        'cc-by', 'cc-by-3.0', 'cc-by-4.0',
        'cc0', 'cc-0', 'public-domain', 'public domain'
      )
    )
  ),
  CONSTRAINT paper_full_texts_unsuccessful_reason_check CHECK (
    retrieval_status = 'fetched' OR nullif(rejection_reason, '') IS NOT NULL
  )
);

CREATE INDEX paper_full_texts_candidate_retrieved_idx
  ON papers_raw.paper_full_texts (paper_candidate_id, retrieved_at DESC);
CREATE INDEX paper_full_texts_success_idx
  ON papers_raw.paper_full_texts (paper_candidate_id, retrieved_at DESC)
  WHERE retrieval_status = 'fetched';
CREATE INDEX paper_full_texts_source_url_idx
  ON papers_raw.paper_full_texts (paper_candidate_id, source_url);

COMMENT ON TABLE papers_raw.paper_full_texts IS
  'Append-only audit of OA PDF retrievals. Stores bounded extracted text and source/license provenance, never the PDF bytes.';
COMMENT ON COLUMN papers_raw.paper_full_texts.license IS
  'License identifier reported by OpenAlex best_oa_location. Only the migration allowlist can reach fetched status.';
COMMENT ON COLUMN papers_raw.paper_full_texts.content_sha256 IS
  'SHA-256 of the downloaded PDF bytes, retained for provenance and change detection.';

ALTER TABLE papers_raw.paper_full_texts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE papers_raw.paper_full_texts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE papers_raw.paper_full_texts TO service_role;

ALTER TABLE knowledge.evidence_spans
  ADD COLUMN full_text_id uuid
  REFERENCES papers_raw.paper_full_texts(id) ON DELETE RESTRICT;

CREATE INDEX evidence_spans_full_text_id_idx
  ON knowledge.evidence_spans (full_text_id)
  WHERE full_text_id IS NOT NULL;

ALTER TABLE knowledge.evidence_spans
  ADD CONSTRAINT evidence_spans_full_text_provenance_check CHECK (
    (source_field = 'full_text' AND full_text_id IS NOT NULL)
    OR (source_field != 'full_text' AND full_text_id IS NULL)
  );

COMMENT ON COLUMN knowledge.evidence_spans.full_text_id IS
  'Exact OA full-text retrieval record whose extracted-text offsets support this span.';
