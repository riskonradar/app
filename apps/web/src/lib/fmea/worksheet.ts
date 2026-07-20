import { turbofanComponents } from "@/data/turbofan-components";
import { scoreSuggestionsForRow } from "@/lib/fmea/scoring";
import { scoreOptions } from "@/lib/fmea/table";
import type {
  EvidenceReference,
  EvidenceRow,
  FmeaEvidenceField,
  FmeaRow,
  KnowledgeSearchRow,
  Source,
  TaxonomySearchType,
} from "@/lib/fmea/types";

export type SystemTemplate = {
  id: string;
  name: string;
  domain: string;
  source: string;
  description: string;
  components: string[];
};

export type SelectionStep = "initial" | "table";
export type LoadingAction = "upload" | "system" | "export" | null;
export type AnalysisLoadState = "idle" | "loading" | "ready" | "error";

export type SavedAnalysisResponse = {
  analysis?: { id: string; name: string; rows: FmeaRow[] };
  analyses?: Array<{ id: string }>;
  error?: string;
  plan?: { isPro: boolean; savedAnalysisLimit: number | null; status: string };
};

export type KnowledgeSearchResponse = {
  rows?: KnowledgeSearchRow[];
  total?: number;
  pagination?: { limit: number; offset: number; hasNext: boolean };
  taxonomyMatch?: {
    id: string;
    type: TaxonomySearchType;
    name: string;
    slug: string;
    path: string;
  } | null;
  error?: string;
};

export const systemTemplates: SystemTemplate[] = [
  {
    id: "turbofan",
    name: "Turbofan engine",
    domain: "Aviation propulsion",
    source: "Live shared knowledge graph",
    description: "Queries current taxonomy-linked evidence for the major turbofan components.",
    components: [...turbofanComponents],
  },
];

function normalizedKey(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function makeRowId(row: Pick<FmeaRow, "component" | "failureMode">, index: number) {
  return `${row.component}-${row.failureMode || "new-failure-mode"}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function scoreValue(value: string) {
  return scoreOptions.includes(value) ? value : "";
}

export function sortedComponentNames(names: string[]) {
  return [...names].sort((a, b) => a.localeCompare(b));
}

function mergeListValues(...values: string[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.split(";"))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).join("; ");
}

function mergeStringArrays(...values: Array<string[] | undefined>) {
  return Array.from(
    new Set(values.flatMap((value) => value ?? []).map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function sourceKey(source: Source) {
  return source.doi || source.url || source.title || JSON.stringify(source);
}

export function displaySafeEvidence(evidence: EvidenceReference[]) {
  return evidence.map((reference) => ({
    ...reference,
    spans: reference.spans.filter((span) => span.licenseSafe === true),
  }));
}

function mergeEvidenceRows(rows: EvidenceRow[]) {
  const merged = new Map<string, EvidenceRow>();

  for (const row of rows) {
    const component = row.component.trim();
    const failureMode = row.failureMode.trim();
    if (!component || !failureMode) continue;
    const componentKey = row.componentTaxonomyId || normalizedKey(component);
    const failureModeKey = row.failureModeTaxonomyId || normalizedKey(failureMode);
    const domains = mergeStringArrays(row.domains);
    const operatingContexts = mergeStringArrays(row.operatingContexts);
    // Cross-domain evidence remains in separate worksheet contributions. Risk
    // scores and controls cannot safely be transferred between contexts merely
    // because component and failure-mode taxonomy nodes match.
    const contextKey = [...domains, ...operatingContexts].map(normalizedKey).join("|");
    const key = `${componentKey}::${failureModeKey}::${contextKey || "unscoped"}`;
    const existing = merged.get(key);
    const safeEvidence = displaySafeEvidence(row.evidence ?? []);

    if (!existing) {
      merged.set(key, {
        ...row,
        component,
        failureMode,
        effect: mergeListValues(row.effect),
        cause: mergeListValues(row.cause),
        correctiveAction: mergeListValues(row.correctiveAction),
        currentControl: mergeListValues(row.currentControl ?? ""),
        severity: "",
        occurrence: "",
        detection: "",
        evidenceCount: Number(row.evidenceCount || 0),
        sources: row.sources ?? [],
        evidence: safeEvidence,
        domains,
        operatingContexts,
      });
      continue;
    }

    const sourcesByKey = new Map(existing.sources.map((source) => [sourceKey(source), source]));
    for (const source of row.sources ?? []) sourcesByKey.set(sourceKey(source), source);
    const evidenceByKey = new Map(
      existing.evidence.map((reference) => [`${reference.field}:${reference.claimId}`, reference]),
    );
    for (const reference of safeEvidence) {
      evidenceByKey.set(`${reference.field}:${reference.claimId}`, reference);
    }

    merged.set(key, {
      ...existing,
      effect: mergeListValues(existing.effect, row.effect),
      cause: mergeListValues(existing.cause, row.cause),
      correctiveAction: mergeListValues(existing.correctiveAction, row.correctiveAction),
      currentControl: mergeListValues(existing.currentControl ?? "", row.currentControl ?? ""),
      severity: "",
      occurrence: "",
      detection: "",
      evidenceCount: sourcesByKey.size,
      sources: Array.from(sourcesByKey.values()),
      evidence: Array.from(evidenceByKey.values()),
      domains: mergeStringArrays(existing.domains, row.domains),
      operatingContexts: mergeStringArrays(existing.operatingContexts, row.operatingContexts),
    });
  }

  return Array.from(merged.values()).sort(
    (a, b) => a.component.localeCompare(b.component) || b.evidenceCount - a.evidenceCount || a.failureMode.localeCompare(b.failureMode),
  );
}

export function toFmeaRows(rows: EvidenceRow[]): FmeaRow[] {
  return mergeEvidenceRows(rows).map((row, index) => {
    const currentControl = row.currentControl || "";
    const evidenceRow = { ...row, currentControl };
    return {
      ...evidenceRow,
      severity: "",
      occurrence: "",
      detection: "",
      scoreSuggestions: scoreSuggestionsForRow(evidenceRow),
      id: makeRowId(row, index),
      function: "",
      requirement: "",
      industry: industryForRow(row),
      owner: "",
      status: "needs_review",
      included: true,
      provenance: "evidence",
      engineerEditedFields: [],
    };
  });
}

export function normalizeSavedRows(rows: FmeaRow[]): FmeaRow[] {
  return rows.map((row, index) => {
    const engineerEditedFields = Array.isArray(row.engineerEditedFields)
      ? row.engineerEditedFields.filter((field): field is string => typeof field === "string")
      : [];
    const invalidatedEvidenceFields = new Set(
      engineerEditedFields
        .map((field) => evidenceFieldForWorksheetField[field as keyof FmeaRow])
        .filter((field): field is FmeaEvidenceField => Boolean(field)),
    );
    const evidence = displaySafeEvidence(Array.isArray(row.evidence) ? row.evidence : []).filter(
      (reference) => !invalidatedEvidenceFields.has(reference.field),
    );
    const sources = Array.from(
      new Map(evidence.map((reference) => [sourceKey(reference.source), reference.source])).values(),
    );
    return {
      ...row,
      id: row.id || makeRowId(row, index),
      severity: scoreValue(row.severity),
      occurrence: scoreValue(row.occurrence),
      detection: scoreValue(row.detection),
      sources,
      evidence,
      evidenceCount: sources.length,
      scoreSuggestions: row.scoreSuggestions ?? scoreSuggestionsForRow(row),
      domains: Array.isArray(row.domains) ? row.domains : [],
      operatingContexts: Array.isArray(row.operatingContexts) ? row.operatingContexts : [],
      provenance: row.provenance === "manual" ? "manual" : "evidence",
      engineerEditedFields,
      reviewedAt: typeof row.reviewedAt === "string" ? row.reviewedAt : undefined,
    };
  });
}

export function knowledgeRowsToEvidenceRows(rows: KnowledgeSearchRow[]): EvidenceRow[] {
  return rows.map((row) => {
    const evidence = displaySafeEvidence(Array.isArray(row.evidence) ? row.evidence : []);
    const source = evidence[0]?.source ?? {
      title: row.title,
      year: row.publication_year ? String(row.publication_year) : undefined,
      doi: row.doi || undefined,
      url: row.doi ? `https://doi.org/${row.doi}` : undefined,
      category: row.source || row.journal || undefined,
    };
    return {
      componentTaxonomyId: row.component_taxonomy_id ?? undefined,
      failureModeTaxonomyId: row.failure_mode_taxonomy_id ?? undefined,
      component: row.component,
      failureMode: row.failure_mode,
      effect: row.effect ?? "",
      cause: row.cause ?? "",
      currentControl: row.control ?? "",
      severity: "",
      occurrence: "",
      detection: "",
      correctiveAction: evidence
        .filter((reference) => reference.field === "recommended_action")
        .map((reference) => reference.value)
        .join("; "),
      rpn: "",
      evidenceCount: 1,
      sources: [source],
      evidence,
      domains: row.domain ? [row.domain] : [],
      operatingContexts: evidence
        .filter((reference) => ["operating_context", "environment"].includes(reference.claimType))
        .map((reference) => reference.value),
    };
  });
}

function industryForRow(row: EvidenceRow) {
  const domains = mergeStringArrays(row.domains);
  if (domains.length) return domains.join("; ");
  const sourceText = row.sources
    .map((source) => `${source.category ?? ""} ${source.title ?? ""}`)
    .join(" ")
    .toLowerCase();
  return sourceText.includes("easa") || sourceText.includes("turbofan") || sourceText.includes("aircraft")
    ? "Aviation"
    : "";
}

export function templateRowsForComponents(components: string[]): FmeaRow[] {
  return components.map((component, index) => ({
    id: makeRowId({ component, failureMode: "" }, index),
    component,
    function: "",
    requirement: "",
    industry: "",
    failureMode: "",
    effect: "",
    cause: "",
    severity: "",
    occurrence: "",
    detection: "",
    correctiveAction: "",
    currentControl: "",
    owner: "",
    status: "needs_review",
    included: false,
    rpn: "",
    evidenceCount: 0,
    sources: [],
    evidence: [],
    scoreSuggestions: {},
    domains: [],
    operatingContexts: [],
    provenance: "manual",
    engineerEditedFields: [],
  }));
}

export function parseBom(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.split(/,|\t|;/)[0]?.trim())
        .filter((item) => item && !/^(part|component|item|bom|name)$/i.test(item))
        .slice(0, 18),
    ),
  );
}

export function rowRpn(row: FmeaRow) {
  const severity = Number(row.severity);
  const occurrence = Number(row.occurrence);
  const detection = Number(row.detection);
  if (row.rpn) return row.rpn;
  if (!severity || !occurrence || !detection) return "";
  return String(severity * occurrence * detection);
}

export function numericRowRpn(row: FmeaRow) {
  return Number(rowRpn(row)) || 0;
}

export function defaultAnalysisName(rows: FmeaRow[]) {
  const components = sortedComponentNames(Array.from(new Set(rows.map((row) => row.component))));
  return components.length === 1
    ? `${components[0]} Failure Mode and Effects Analysis`
    : "Reliability evidence Failure Mode and Effects Analysis";
}

const evidenceFieldForWorksheetField: Partial<Record<keyof FmeaRow, FmeaEvidenceField>> = {
  component: "component",
  failureMode: "failure_mode",
  effect: "effect",
  cause: "cause",
  currentControl: "controls",
  correctiveAction: "recommended_action",
};

const reviewSensitiveFields = new Set<keyof FmeaRow>([
  "component",
  "function",
  "requirement",
  "industry",
  "failureMode",
  "effect",
  "severity",
  "cause",
  "occurrence",
  "currentControl",
  "detection",
  "correctiveAction",
]);

function sourceIdentity(source: Source) {
  return source.doi || source.url || `${source.title}:${source.year ?? ""}`;
}

/**
 * Applies an engineer edit without allowing an accepted row or field-level
 * evidence reference to remain falsely current. The database records the
 * accepted -> edited/needs-review transition in its immutable review events.
 */
export function applyFmeaRowUpdate(
  row: FmeaRow,
  update: Partial<FmeaRow>,
  editedAt = new Date().toISOString(),
) {
  const changedFields = (Object.keys(update) as Array<keyof FmeaRow>).filter(
    (field) => update[field] !== undefined && update[field] !== row[field],
  );
  if (!changedFields.length) return row;

  const contentFields = changedFields.filter((field) => reviewSensitiveFields.has(field));
  const invalidatedEvidenceFields = new Set(
    contentFields
      .map((field) => evidenceFieldForWorksheetField[field])
      .filter((field): field is FmeaEvidenceField => Boolean(field)),
  );
  const remainingEvidence = invalidatedEvidenceFields.size
    ? row.evidence.filter((reference) => !invalidatedEvidenceFields.has(reference.field))
    : row.evidence;
  const sources = invalidatedEvidenceFields.size
    ? Array.from(
        new Map(remainingEvidence.map((reference) => [sourceIdentity(reference.source), reference.source])).values(),
      )
    : row.sources;

  const statusWasExplicitlyChanged = changedFields.includes("status");
  const nextStatus = statusWasExplicitlyChanged
    ? update.status ?? row.status
    : contentFields.length && row.status === "accepted"
      ? "edited"
      : contentFields.length && row.status === "rejected"
        ? "needs_review"
        : row.status;

  return {
    ...row,
    ...update,
    status: nextStatus,
    evidence: remainingEvidence,
    sources,
    evidenceCount: sources.length,
    engineerEditedFields: contentFields.length
      ? mergeStringArrays(row.engineerEditedFields, contentFields.map(String))
      : row.engineerEditedFields,
    reviewedAt:
      statusWasExplicitlyChanged && update.status === "accepted"
        ? editedAt
        : contentFields.length
          ? undefined
          : row.reviewedAt,
  } satisfies FmeaRow;
}

export function applyEvidenceClaimReview(
  row: FmeaRow,
  claimId: string,
  reviewStatus: "accepted" | "rejected" | "needs_review",
) {
  if (!row.evidence.some((reference) => reference.claimId === claimId)) return row;
  const evidence = row.evidence
    .map((reference) =>
      reference.claimId === claimId ? { ...reference, reviewStatus } : reference,
    )
    .filter((reference) => reference.reviewStatus !== "rejected");
  const sources = Array.from(
    new Map(evidence.map((reference) => [sourceIdentity(reference.source), reference.source])).values(),
  );
  return {
    ...row,
    evidence,
    sources,
    evidenceCount: sources.length,
    status: row.status === "accepted" ? "edited" : row.status,
    reviewedAt: row.status === "accepted" ? undefined : row.reviewedAt,
  } satisfies FmeaRow;
}

export function canPersistWorksheet(
  loadState: AnalysisLoadState,
  currentAnalysisId: string | null,
  expectedRowIds: string[] | null,
) {
  if (loadState === "loading" || loadState === "error") return false;
  // An existing analysis is saveable only after a successful load supplied an
  // exact baseline. New, unsaved analyses do not require this concurrency guard.
  return currentAnalysisId === null || expectedRowIds !== null;
}

export function isFinalExportEligible(row: FmeaRow) {
  return (
    row.included &&
    row.status === "accepted" &&
    row.provenance === "evidence" &&
    row.evidence.length > 0 &&
    isComplete(row)
  );
}

export function selectRowsForExport(rows: FmeaRow[], mode: "final" | "draft") {
  if (mode === "final") return rows.filter(isFinalExportEligible);
  return rows.filter((row) => row.included && row.status !== "rejected");
}

export function isComplete(row: FmeaRow) {
  return Boolean(
    row.component &&
      row.function &&
      row.failureMode &&
      row.effect &&
      row.cause &&
      row.severity &&
      row.occurrence &&
      row.detection &&
      row.currentControl,
  );
}

export function rowsWithUniqueIds(nextRows: FmeaRow[], existingRows: FmeaRow[]) {
  const usedIds = new Set(existingRows.map((row) => row.id));
  return nextRows.map((row, index) => {
    if (!usedIds.has(row.id)) {
      usedIds.add(row.id);
      return row;
    }
    const id = `${row.id}-added-${Date.now()}-${index}`;
    usedIds.add(id);
    return { ...row, id };
  });
}
