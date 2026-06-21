import { getSupabaseAnonClient } from "@/lib/supabase/server";
import propagationPaths from "@/data/turbofan-propagation-paths.json";

type SupabaseFmeaRow = {
  component: string;
  failure_mode: string;
  effect: string | null;
  cause: string | null;
  severity: string | null;
  occurrence: string | null;
  detection: string | null;
  corrective_action: string | null;
  rpn: string | null;
  evidence_count: number;
  sources: unknown[];
  component_order: number;
  source_record_count?: number;
  relevant_record_count?: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 1000);

  const supabase = getSupabaseAnonClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_turbofan_fmea", { p_limit: limit });

  if (error) {
    console.error("get_turbofan_fmea error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const typedRows = (data ?? []) as SupabaseFmeaRow[];
  const components = [
    ...new Set(
      typedRows
        .sort((a, b) => a.component_order - b.component_order)
        .map((row) => row.component),
    ),
  ];

  return Response.json({
    system: "Turbofan engine",
    sourceType: "Supabase journal papers and EASA AD reports",
    recordCount: Number(typedRows[0]?.source_record_count ?? 0),
    relevantRecordCount: Number(typedRows[0]?.relevant_record_count ?? 0),
    rowCount: typedRows.length,
    components,
    rows: typedRows.map((row) => ({
      component: row.component,
      failureMode: row.failure_mode,
      effect: row.effect ?? "",
      cause: row.cause ?? "",
      severity: row.severity || inferSeverity(row),
      occurrence: row.occurrence || inferOccurrence(row),
      detection: row.detection || inferDetection(row),
      correctiveAction: row.corrective_action ?? "",
      rpn: row.rpn ?? "",
      evidenceCount: Number(row.evidence_count || 0),
      sources: Array.isArray(row.sources) ? row.sources : [],
    })),
  });
}

function inferSeverity(row: SupabaseFmeaRow) {
  const effect = row.effect ?? "";
  const directScore = inferSeverityFromEffect(effect);
  if (!effect.trim()) return "";
  if (directScore && !isVagueEffect(effect)) return directScore;

  const pathScore = inferSeverityFromPropagationPath([
    row.component,
    row.failure_mode,
    row.cause ?? "",
    effect,
  ]);

  return pathScore || directScore;
}

function inferOccurrence(row: SupabaseFmeaRow) {
  const weightedEvidence = weightedEvidenceCount(row.sources, row.evidence_count);
  if (!weightedEvidence) return "";

  const causeText = row.cause ?? "";
  const baseScore =
    weightedEvidence >= 24
      ? 8
      : weightedEvidence >= 16
        ? 7
        : weightedEvidence >= 10
          ? 6
          : weightedEvidence >= 5
            ? 5
            : weightedEvidence >= 3
              ? 4
              : 3;

  return String(Math.max(1, Math.min(8, baseScore + causeModifier(causeText))));
}

function inferDetection(row: SupabaseFmeaRow) {
  const rowText = [
    row.component,
    row.failure_mode,
    row.effect ?? "",
    row.cause ?? "",
    row.corrective_action ?? "",
    sourceText(row.sources),
  ]
    .join(" ")
    .toLowerCase();
  const causeFailureText = [row.failure_mode, row.cause ?? "", row.effect ?? ""].join(" ").toLowerCase();

  let score = 6;
  if (
    /inspection|borescope|vibration monitoring|oil debris|magnetic plug|pressure monitoring|egt trend|sensor|alarm/.test(
      rowText,
    )
  ) {
    score -= 2;
  }
  if (hasEasaDetectionInstruction(row.sources)) score -= 1;
  if (
    /fatigue crack growth|manufacturing flaw|near-surface flaw|thermal fatigue|creep|coating degradation|coking|hidden crack/.test(
      causeFailureText,
    )
  ) {
    score += 1;
  }
  if (/bird strike|fod|impact|uncontained failure|blade-out|blade out|rotor burst/.test(causeFailureText)) {
    score += 2;
  }

  return String(Math.max(1, Math.min(10, score)));
}

function sourceText(sources: unknown[]) {
  if (!Array.isArray(sources)) return "";
  return sources
    .map((source) => {
      if (!source || typeof source !== "object") return "";
      const record = source as { title?: string; url?: string; category?: string };
      return [record.title, record.url, record.category].filter(Boolean).join(" ");
    })
    .join(" ");
}

function hasEasaDetectionInstruction(sources: unknown[]) {
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => {
    if (!source || typeof source !== "object") return false;
    const record = source as { category?: string; url?: string; title?: string };
    const category = record.category?.toLowerCase() ?? "";
    const url = record.url?.toLowerCase() ?? "";
    const title = record.title?.toLowerCase() ?? "";
    const isEasa = category.includes("easa") || url.includes("easa.europa.eu") || title.includes("easa ad");
    return isEasa && /inspection|check|test|replacement/.test(title);
  });
}

function weightedEvidenceCount(sources: unknown[], fallbackEvidenceCount: number): number {
  if (!Array.isArray(sources) || sources.length === 0) return Number(fallbackEvidenceCount || 0);

  return sources.reduce<number>((total, source) => {
    if (!source || typeof source !== "object") return total + 1;
    const record = source as { category?: string; url?: string; title?: string };
    const category = record.category?.toLowerCase() ?? "";
    const url = record.url?.toLowerCase() ?? "";
    const title = record.title?.toLowerCase() ?? "";
    if (category.includes("easa") || url.includes("easa.europa.eu") || title.includes("easa ad")) {
      return total + 2;
    }
    return total + 1;
  }, 0);
}

function causeModifier(cause: string) {
  const normalized = cause.toLowerCase();
  let modifier = 0;
  if (
    /fatigue|wear|corrosion|erosion|oxidation|thermal degradation|cyclic stress|progressive|creep|coking|spalling/.test(
      normalized,
    )
  ) {
    modifier += 1;
  }
  if (/bird|foreign object|fod|maintenance error|repair error|impact|ingestion/.test(normalized)) {
    modifier -= 1;
  }
  return modifier;
}

function inferSeverityFromEffect(effect: string) {
  const normalized = effect.toLowerCase();
  if (!normalized.trim()) return "";
  if (/catastrophic|rotor burst|loss of control/.test(normalized)) return "10";
  if (/uncontained release|fire|aircraft damage|safety hazard/.test(normalized)) return "9";
  if (/in-flight shutdown|engine shutdown|engine failure|loss of thrust|major thrust loss|forced landing/.test(normalized)) return "8";
  if (/surge|stall|flameout|high vibration|loss of oil pressure|loss of fuel pressure/.test(normalized)) return "7";
  if (/reduced thrust|performance loss|overtemperature|egt margin|turbine distress|thrust deterioration/.test(normalized)) return "6";
  if (/metallic particle|oil debris|downstream component damage|shop visit|component replacement/.test(normalized)) return "5";
  if (/abnormal noise|local damage|leakage|inspection/.test(normalized)) return "4";
  if (/minor degradation|monitored condition|trend/.test(normalized)) return "3";
  if (/cosmetic|low-level wear|planned maintenance/.test(normalized)) return "2";
  if (/no effect|no safety effect/.test(normalized)) return "1";
  return "";
}

function isVagueEffect(effect: string) {
  return /^(damage|failure|degradation|distress|loss|reduction|wear|crack|fracture|leakage|overheating)(\b| \/|;|$)/i.test(
    effect.trim(),
  );
}

function inferSeverityFromPropagationPath(parts: string[]) {
  const candidateTokens = tokenize(parts.join(" "));
  let bestScore = 0;
  let bestSeverity = "";

  for (const path of propagationPaths) {
    const pathText = [
      path.cause,
      path.componentFailure,
      path.localEffect,
      path.engineEffect,
      path.aircraftMissionConsequence,
    ].join(" ");
    const pathTokens = tokenize(pathText);
    const overlap = pathTokens.filter((token) => candidateTokens.includes(token)).length;
    const componentBoost = candidateTokens.some((token) => path.componentFailure.toLowerCase().includes(token)) ? 2 : 0;
    const causeBoost = candidateTokens.some((token) => path.cause.toLowerCase().includes(token)) ? 2 : 0;
    const score = overlap + componentBoost + causeBoost;

    if (score >= 4 && score > bestScore) {
      bestScore = score;
      bestSeverity = String(path.suggestedSeverity);
    }
  }

  return bestSeverity;
}

function tokenize(value: string) {
  const stopWords = new Set(["and", "or", "the", "with", "from", "into", "risk", "possible"]);
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  );
}
