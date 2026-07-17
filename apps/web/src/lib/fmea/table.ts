import type { FmeaRow } from "@/lib/fmea/types";

export type EditableField =
  | "included"
  | "function"
  | "industry"
  | "failureMode"
  | "effect"
  | "severity"
  | "cause"
  | "occurrence"
  | "currentControl"
  | "detection"
  | "correctiveAction"
  | "status";

export const scoreOptions = Array.from({ length: 10 }, (_, index) => String(index + 1));

export const editableFields: EditableField[] = [
  "included",
  "function",
  "industry",
  "failureMode",
  "effect",
  "severity",
  "cause",
  "occurrence",
  "currentControl",
  "detection",
  "correctiveAction",
  "status",
];

export const fieldHelp: Record<string, string> = {
  included: "Select this row if it should be included in the final Failure Mode and Effects Analysis export.",
  component: "Physical engineering part or subsystem being analyzed.",
  function: "Intended function the component must perform.",
  failureMode: "How the component or function can fail.",
  effect: "Consequence if the failure mode occurs.",
  severity: "Severity score: 1 is minor, 10 is hazardous or catastrophic.",
  cause: "Why the failure mode occurs.",
  occurrence: "Occurrence score: 1 is rare, 10 is frequent.",
  currentControl: "Existing prevention, detection, inspection, design, or maintenance control.",
  detection: "Detection score: 1 is easily detected before harm, 10 is unlikely to be detected.",
  rpn: "Risk Priority Number calculated as Severity x Occurrence x Detection.",
  correctiveAction: "Recommended action to reduce risk or correct a confirmed issue.",
  evidence: "Source count and citations behind the extracted Failure Mode and Effects Analysis fields.",
  status: "Human review state for this row.",
};

export const worksheetColumnSpecs = [
  { id: "included", size: 44 },
  { id: "function", size: 142 },
  { id: "industry", size: 88 },
  { id: "failureMode", size: 150 },
  { id: "effect", size: 164 },
  { id: "severity", size: 72 },
  { id: "cause", size: 164 },
  { id: "occurrence", size: 72 },
  { id: "currentControl", size: 154 },
  { id: "detection", size: 72 },
  { id: "rpn", size: 52 },
  { id: "correctiveAction", size: 150 },
  { id: "evidence", size: 82 },
  { id: "status", size: 44 },
] as const;

export const helpFields = new Set([
  "included",
  "failureMode",
  "severity",
  "occurrence",
  "detection",
  "rpn",
  "evidence",
]);

export function groupRowsByComponent(rows: FmeaRow[]) {
  const grouped = new Map<string, FmeaRow[]>();
  for (const row of rows) {
    const childRows = grouped.get(row.component) ?? [];
    childRows.push(row);
    grouped.set(row.component, childRows);
  }
  return Array.from(grouped.entries()).map(([component, childRows]) => ({ component, childRows }));
}
