import type { EvidenceRow, ScoreSuggestions } from "@/lib/fmea/types";

function clampScore(value: number) {
  return String(Math.max(1, Math.min(10, value)));
}

function severityFromEffect(effect: string) {
  const normalized = effect.toLowerCase();
  if (!normalized.trim()) return "";
  if (/catastrophic|rotor burst|loss of control|structural collapse/.test(normalized)) return "10";
  if (/uncontained release|fire|safety hazard|fatal/.test(normalized)) return "9";
  if (/shutdown|engine failure|loss of thrust|forced landing|operational loss/.test(normalized)) return "8";
  if (/surge|stall|flameout|high vibration|loss of pressure/.test(normalized)) return "7";
  if (/performance loss|overtemperature|distress|deterioration/.test(normalized)) return "6";
  if (/component damage|replacement|shop visit|oil debris/.test(normalized)) return "5";
  if (/local damage|leakage|abnormal noise|inspection/.test(normalized)) return "4";
  if (/minor degradation|monitored condition|trend/.test(normalized)) return "3";
  if (/cosmetic|low-level wear|planned maintenance/.test(normalized)) return "2";
  if (/no effect|no safety effect/.test(normalized)) return "1";
  return "";
}

function occurrenceFromEvidence(row: EvidenceRow) {
  if (!row.evidenceCount) return "";
  const base = row.evidenceCount >= 20 ? 7 : row.evidenceCount >= 10 ? 6 : row.evidenceCount >= 5 ? 5 : row.evidenceCount >= 3 ? 4 : 3;
  const modifier = /fatigue|wear|corrosion|erosion|oxidation|cyclic|progressive|creep|spalling/i.test(row.cause)
    ? 1
    : /foreign object|impact|maintenance error|repair error/i.test(row.cause)
      ? -1
      : 0;
  return clampScore(base + modifier);
}

function detectionFromEvidence(row: EvidenceRow) {
  const text = [row.failureMode, row.effect, row.cause, row.currentControl, row.correctiveAction]
    .join(" ")
    .toLowerCase();
  let score = 6;
  if (/inspection|borescope|vibration monitoring|oil debris|ultrasonic|penetrant|sensor|alarm/.test(text)) score -= 2;
  if (/hidden crack|manufacturing flaw|near-surface flaw|creep|coating degradation/.test(text)) score += 1;
  if (/foreign object|impact|uncontained|burst/.test(text)) score += 2;
  return clampScore(score);
}

export function scoreSuggestionsForRow(row: EvidenceRow): ScoreSuggestions {
  const severity = severityFromEffect(row.effect);
  const occurrence = occurrenceFromEvidence(row);
  const detection = detectionFromEvidence(row);

  return {
    ...(severity
      ? {
          severity: {
            value: severity,
            rationale: "Keyword-based indication from the documented effect. Confirm against the severity reference and your system boundary.",
          },
        }
      : {}),
    ...(occurrence
      ? {
          occurrence: {
            value: occurrence,
            rationale: "Corpus-frequency indication only. Set occurrence from field history, duty cycle, and the applicable occurrence table.",
          },
        }
      : {}),
    ...(detection
      ? {
          detection: {
            value: detection,
            rationale: "Keyword-based indication from documented controls and detectability. Confirm against the actual control plan.",
          },
        }
      : {}),
  };
}
