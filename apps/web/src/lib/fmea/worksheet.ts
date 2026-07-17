import fmeaData from "@/data/fmea-turbofan-data.json";
import { scoreSuggestionsForRow } from "@/lib/fmea/scoring";
import { scoreOptions } from "@/lib/fmea/table";
import type {
  EvidenceReference,
  EvidenceRow,
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
    components: fmeaData.components as string[],
  },
];

const defaultControls = [
  "Visual inspection",
  "Vibration monitoring",
  "Oil debris analysis",
  "Scheduled overhaul",
  "Borescope inspection",
  "Thermal trend monitoring",
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
    const key = `${componentKey}::${failureModeKey}`;
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
      function: `Define intended function for ${row.component}`,
      requirement: "Maintain intended system function under defined operating conditions",
      industry: industryForRow(row),
      owner: "",
      status: "needs_review",
      included: true,
    };
  });
}

export function normalizeSavedRows(rows: FmeaRow[]) {
  return rows.map((row, index) => ({
    ...row,
    id: row.id || makeRowId(row, index),
    severity: scoreValue(row.severity),
    occurrence: scoreValue(row.occurrence),
    detection: scoreValue(row.detection),
    sources: Array.isArray(row.sources) ? row.sources : [],
    evidence: displaySafeEvidence(Array.isArray(row.evidence) ? row.evidence : []),
    scoreSuggestions: row.scoreSuggestions ?? scoreSuggestionsForRow(row),
  }));
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
    };
  });
}

function industryForRow(row: EvidenceRow) {
  const sourceText = row.sources
    .map((source) => `${source.category ?? ""} ${source.title ?? ""}`)
    .join(" ")
    .toLowerCase();
  return sourceText.includes("easa") || sourceText.includes("turbofan") || sourceText.includes("aircraft")
    ? "Aviation"
    : "Cross-industry reliability";
}

export function templateRowsForComponents(components: string[]): FmeaRow[] {
  return components.map((component, index) => ({
    id: makeRowId({ component, failureMode: "" }, index),
    component,
    function: `Define intended function for ${component}`,
    requirement: "Define requirement",
    industry: "Cross-industry reliability",
    failureMode: "",
    effect: "",
    cause: "",
    severity: "",
    occurrence: "",
    detection: "",
    correctiveAction: "",
    currentControl: defaultControls[index % defaultControls.length],
    owner: "",
    status: "needs_review",
    included: true,
    rpn: "",
    evidenceCount: 0,
    sources: [],
    evidence: [],
    scoreSuggestions: {},
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

export function isComplete(row: FmeaRow) {
  if (!row.included) return true;
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
