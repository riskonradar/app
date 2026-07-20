export type FmeaEvidenceField =
  | "component"
  | "failure_mode"
  | "effect"
  | "cause"
  | "controls"
  | "detection"
  | "recommended_action";

export type EvidenceSpan = {
  id: string;
  sourceField: string;
  text: string;
  charStart: number | null;
  charEnd: number | null;
  licenseSafe: boolean;
};

export type EvidenceReference = {
  field: FmeaEvidenceField;
  claimId: string;
  claimType: string;
  value: string;
  confidence: number | null;
  supportType: string;
  reviewStatus: string;
  inferenceRationale?: string;
  classifierVersion?: string;
  llmProvider?: string;
  llmModel?: string;
  relationshipId?: string;
  spans: EvidenceSpan[];
  source: Source;
};

export type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
  category?: string;
};

export type ScoreSuggestion = {
  value: string;
  rationale: string;
};

export type ScoreSuggestions = {
  severity?: ScoreSuggestion;
  occurrence?: ScoreSuggestion;
  detection?: ScoreSuggestion;
};

export type TaxonomySearchType = "component" | "failure_mode";

export type EvidenceRow = {
  componentTaxonomyId?: string;
  failureModeTaxonomyId?: string;
  component: string;
  failureMode: string;
  effect: string;
  cause: string;
  severity: string;
  occurrence: string;
  detection: string;
  correctiveAction: string;
  currentControl?: string;
  rpn: string;
  evidenceCount: number;
  sources: Source[];
  evidence: EvidenceReference[];
  scoreSuggestions?: ScoreSuggestions;
  domains?: string[];
  operatingContexts?: string[];
};

export type FmeaRow = EvidenceRow & {
  id: string;
  function: string;
  requirement: string;
  industry: string;
  currentControl: string;
  owner: string;
  status: "needs_review" | "accepted" | "edited" | "rejected";
  included: boolean;
  provenance: "evidence" | "manual";
  engineerEditedFields: string[];
  reviewedAt?: string;
};

export type KnowledgeSearchRow = {
  failure_mode_claim_id: string;
  failure_mode_taxonomy_id: string | null;
  failure_mode_slug: string | null;
  component_taxonomy_id: string | null;
  component_slug: string | null;
  component: string;
  failure_mode: string;
  cause: string | null;
  effect: string | null;
  control: string | null;
  domain?: string | null;
  confidence: number | null;
  review_status?: string;
  doi: string | null;
  title: string;
  journal: string | null;
  publication_year: number | null;
  source?: string | null;
  source_url?: string | null;
  total_count: number;
  evidence?: EvidenceReference[];
};
