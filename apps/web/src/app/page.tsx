"use client";

import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";

import { AppNav } from "@/components/app-nav";
import fmeaData from "@/data/fmea-turbofan-data.json";
import detectionReference from "@/data/fmea-detection-reference.json";
import occurrenceReference from "@/data/fmea-occurrence-reference.json";
import severityReference from "@/data/fmea-severity-reference.json";
import propagationPaths from "@/data/turbofan-propagation-paths.json";

type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
  category?: string;
  evidenceText?: string;
  sourceField?: string;
  charStart?: number;
  charEnd?: number;
};

type EvidenceRow = {
  component: string;
  failureMode: string;
  effect: string;
  cause: string;
  severity: string;
  occurrence: string;
  detection: string;
  correctiveAction: string;
  rpn: string;
  evidenceCount: number;
  sources: Source[];
};

type FmeaRow = EvidenceRow & {
  id: string;
  function: string;
  requirement: string;
  industry: string;
  currentControl: string;
  owner: string;
  status: "needs_review" | "accepted" | "rejected";
  included: boolean;
};

type SystemTemplate = {
  id: string;
  name: string;
  domain: string;
  source: string;
  description: string;
  components: string[];
};

type FmeaDataset = {
  system?: string;
  sourceType?: string;
  recordCount: number;
  relevantRecordCount?: number;
  rowCount: number;
  components: string[];
  rows: EvidenceRow[];
};

type SelectionStep = "initial" | "table";
type EditableField =
  | "included"
  | "failureMode"
  | "effect"
  | "severity"
  | "cause"
  | "occurrence"
  | "currentControl"
  | "detection"
  | "correctiveAction"
  | "status";

type LoadingAction = "upload" | "system" | "export" | null;

const systemTemplates: SystemTemplate[] = [
  {
    id: "turbofan",
    name: "Turbofan engine",
    domain: "Aviation propulsion",
    source: `${fmeaData.recordCount} evidence records from papers + EASA; ${fmeaData.rowCount} merged FMEA rows`,
    description:
      "A preloaded reliability workspace built from the turbofan prototype corpus.",
    components: fmeaData.components as string[],
  },
  {
    id: "pump-train",
    name: "Centrifugal pump train",
    domain: "Process equipment",
    source: "Template system",
    description:
      "Starter structure for pump, seal, bearing, coupling, motor, and instrumentation FMEAs.",
    components: [
      "Pump casing",
      "Impeller",
      "Mechanical seal",
      "Shaft",
      "Bearing",
      "Coupling",
      "Electric motor",
      "Vibration sensor",
    ],
  },
  {
    id: "wind-drivetrain",
    name: "Wind turbine drivetrain",
    domain: "Renewable energy",
    source: "Template system",
    description:
      "Starter structure for gearbox, blade, bearing, generator, converter, brake, and tower interfaces.",
    components: [
      "Blade",
      "Pitch bearing",
      "Main shaft",
      "Main bearing",
      "Gearbox",
      "Generator",
      "Power converter",
      "Brake system",
    ],
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

const scoreOptions = Array.from({ length: 10 }, (_, index) => String(index + 1));
const bundledTurbofanData = fmeaData as FmeaDataset;
const editableFields: EditableField[] = [
  "included",
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

const fieldHelp: Record<string, string> = {
  included: "Whether this failure mode row should be included in the exported FMEA spreadsheet.",
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
  evidence: "Source count and citations behind the extracted FMEA fields.",
  status: "Human review state for this row.",
};

const worksheetColumnSpecs = [
  { id: "included", size: 76 },
  { id: "function", size: 108 },
  { id: "industry", size: 92 },
  { id: "failureMode", size: 118 },
  { id: "effect", size: 116 },
  { id: "severity", size: 50 },
  { id: "cause", size: 116 },
  { id: "occurrence", size: 50 },
  { id: "currentControl", size: 118 },
  { id: "detection", size: 50 },
  { id: "rpn", size: 60 },
  { id: "correctiveAction", size: 110 },
  { id: "evidence", size: 82 },
  { id: "status", size: 106 },
] as const;

const helpFields = new Set(["included", "failureMode", "severity", "occurrence", "detection", "rpn", "evidence"]);
const turbofanComponents = [
  "Bearing",
  "Combustor",
  "Engine inlet / intake",
  "Engine mount",
  "Exhaust",
  "Fan / fan blade",
  "Fan case",
  "Gearbox / accessory gearbox",
  "High-pressure compressor",
  "High-pressure turbine",
  "Low-pressure compressor",
  "Low-pressure turbine",
  "Nacelle",
  "Nozzle / fuel injector",
  "Oil system / lubrication",
  "Pump",
  "Seal",
  "Sensor / instrumentation",
  "Shaft",
  "Valve",
];

const componentRank = new Map(turbofanComponents.map((component, index) => [component, index]));
const componentFamilies: Array<[RegExp, string | null]> = [
  [/\b(genx|tfe731|turbofan engine|turbo fan engine|aero engine|aero-engine)\b/i, null],
  [/\b(bearing|bearings)\b/i, "Bearing"],
  [/\b(combustor|combustion chamber|combustion outer liner)\b/i, "Combustor"],
  [/\b(inlet|intake|nose cowl|air intake|duct liner)\b/i, "Engine inlet / intake"],
  [/\b(engine mount|engine support|support looseness|mounts?)\b/i, "Engine mount"],
  [/\b(exhaust|thrust reverser|muffler|noise suppressor)\b/i, "Exhaust"],
  [/\b(fan blade|fan blades|turbofan blade|fan hub|engine fan hub|fan rotor|fan stage|fan stator|mistuned fan|variable pitch fan|fan disc|fan disk)\b/i, "Fan / fan blade"],
  [/\b(fan case|fan casing|fan containment|fan cowl)\b/i, "Fan case"],
  [/\b(gearbox|gear box|accessory gearbox|reduction gearbox|gear)\b/i, "Gearbox / accessory gearbox"],
  [/\b(high[- ]pressure(?:\s*\([^)]+\))?\s+compressor|hpc|compressor blade)\b/i, "High-pressure compressor"],
  [/\b(high[- ]pressure(?:\s*\([^)]+\))?\s+turbine|hpt|hp turbine|turbine blade|turbine components?|turbine disk|turbine disc|disk posts?|firtree)\b/i, "High-pressure turbine"],
  [/\b(low[- ]pressure(?:\s*\([^)]+\))?\s+compressor|lpc)\b/i, "Low-pressure compressor"],
  [/\b(low[- ]pressure(?:\s*\([^)]+\))?\s+turbine|lpt|lp turbine)\b/i, "Low-pressure turbine"],
  [/\b(nacelle|cowling|cowl)\b/i, "Nacelle"],
  [/\b(fuel nozzle|fuel injector|injector|nozzle|fuel manifold|fuel metering)\b/i, "Nozzle / fuel injector"],
  [/\b(oil system|lubrication|lubricant|engine oil|oil filter|oil strainer|air\/oil|heat exchanger)\b/i, "Oil system / lubrication"],
  [/\b(oil pump|fuel pump|scavenge pump|pump)\b/i, "Pump"],
  [/\b(air seal|sealing ring|seal|seals)\b/i, "Seal"],
  [/\b(fadec|eec|electronic engine control|engine controls?|sensor|sensors|actuator|actuators|variable geometry|instrumentation)\b/i, "Sensor / instrumentation"],
  [/\b(inter[- ]shaft|rotor shaft|compressor shaft|dual-rotor|turbofan rotor|shaft|spool)\b/i, "Shaft"],
  [/\b(operability bleed valve|obv|bleed valve|valve|valves|bypass valve)\b/i, "Valve"],
];

function makeRowId(row: Pick<FmeaRow, "component" | "failureMode">, index: number) {
  return `${row.component}-${row.failureMode}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function scoreValue(value: string) {
  return scoreOptions.includes(value) ? value : "";
}

function canonicalComponentName(component: string) {
  const normalized = component.trim();
  for (const [pattern, family] of componentFamilies) {
    if (pattern.test(normalized)) return family;
  }
  return normalized || null;
}

function sortedComponentNames(names: string[]) {
  return [...names].sort((a, b) => {
    const rankA = componentRank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rankB = componentRank.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
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

function maxScore(...values: string[]) {
  const scores = values.map(scoreValue).filter(Boolean).map(Number);
  return scores.length ? String(Math.max(...scores)) : "";
}

function sourceKey(source: Source) {
  return source.doi || source.url || source.title || JSON.stringify(source);
}

function mergeEvidenceRows(rows: EvidenceRow[]) {
  const merged = new Map<string, EvidenceRow>();

  rows.forEach((row) => {
    const component = canonicalComponentName(row.component);
    if (!component || !row.failureMode.trim()) return;
    const key = `${component.toLowerCase()}::${row.failureMode.trim().toLowerCase()}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        ...row,
        component,
        effect: mergeListValues(row.effect),
        cause: mergeListValues(row.cause),
        correctiveAction: mergeListValues(row.correctiveAction),
        severity: scoreValue(row.severity),
        occurrence: scoreValue(row.occurrence),
        detection: scoreValue(row.detection),
        evidenceCount: Number(row.evidenceCount || 0),
        sources: row.sources ?? [],
      });
      return;
    }

    const sourcesByKey = new Map(existing.sources.map((source) => [sourceKey(source), source]));
    (row.sources ?? []).forEach((source) => sourcesByKey.set(sourceKey(source), source));

    merged.set(key, {
      ...existing,
      effect: mergeListValues(existing.effect, row.effect),
      cause: mergeListValues(existing.cause, row.cause),
      correctiveAction: mergeListValues(existing.correctiveAction, row.correctiveAction),
      severity: maxScore(existing.severity, row.severity),
      occurrence: maxScore(existing.occurrence, row.occurrence),
      detection: maxScore(existing.detection, row.detection),
      evidenceCount: Number(existing.evidenceCount || 0) + Number(row.evidenceCount || 0),
      sources: Array.from(sourcesByKey.values()),
    });
  });

  return Array.from(merged.values()).sort((a, b) => {
    const componentDelta =
      (componentRank.get(a.component) ?? Number.MAX_SAFE_INTEGER) -
      (componentRank.get(b.component) ?? Number.MAX_SAFE_INTEGER);
    if (componentDelta) return componentDelta;
    return b.evidenceCount - a.evidenceCount || a.failureMode.localeCompare(b.failureMode);
  });
}

function toFmeaRows(rows: EvidenceRow[]): FmeaRow[] {
  return mergeEvidenceRows(rows).map((row, index) => ({
    ...row,
    severity: scoreValue(row.severity),
    occurrence: scoreValue(row.occurrence),
    detection: scoreValue(row.detection),
    id: makeRowId(row, index),
    function: functionForComponent(row.component),
    requirement: "Maintain intended system function under defined operating conditions",
    industry: industryForRow(row),
    currentControl: row.correctiveAction || defaultControls[index % defaultControls.length],
    owner: "",
    status: "needs_review",
    included: true,
  }));
}

function normalizeSavedRows(rows: FmeaRow[]) {
  const mergedRows = toFmeaRows(rows);
  const savedByKey = new Map(
    rows.map((row) => [
      `${canonicalComponentName(row.component) ?? row.component}::${row.failureMode}`.toLowerCase(),
      row,
    ]),
  );

  return mergedRows.map((row) => {
    const saved = savedByKey.get(`${row.component}::${row.failureMode}`.toLowerCase());
    return saved
      ? {
          ...row,
          requirement: saved.requirement || row.requirement,
          industry: saved.industry || row.industry,
          currentControl: saved.currentControl || row.currentControl,
          owner: saved.owner || row.owner,
          status: saved.status || row.status,
          included: saved.included,
        }
      : row;
  });
}

function functionForComponent(component: string) {
  const lower = component.toLowerCase();
  if (lower.includes("bearing")) return "Support rotating load with controlled friction";
  if (lower.includes("blade") || lower.includes("fan")) return "Convert shaft power into controlled airflow";
  if (lower.includes("compressor")) return "Increase working-fluid pressure for combustion";
  if (lower.includes("turbine")) return "Extract gas-path energy into shaft power";
  if (lower.includes("shaft")) return "Transmit torque across rotating assemblies";
  if (lower.includes("gear")) return "Transfer speed and torque through accessory drives";
  if (lower.includes("seal")) return "Contain fluid and isolate pressure boundaries";
  return `Perform ${component.toLowerCase()} function`;
}

function industryForRow(row: EvidenceRow) {
  const sourceText = row.sources
    .map((source) => `${source.category ?? ""} ${source.title ?? ""}`)
    .join(" ")
    .toLowerCase();

  if (sourceText.includes("easa") || sourceText.includes("turbofan") || sourceText.includes("aircraft")) {
    return "Aviation";
  }

  return "Cross-industry reliability";
}

function templateRowsForComponents(components: string[]): FmeaRow[] {
  const failureModes = [
    "Fatigue cracking",
    "Wear / material loss",
    "Corrosion / pitting",
    "Loss of alignment",
    "Thermal degradation",
  ];

  return components.flatMap((component, componentIndex) =>
    failureModes.slice(0, 3).map((failureMode, failureIndex) => {
      const index = componentIndex * 3 + failureIndex;
      return {
        id: makeRowId({ component, failureMode }, index),
        component,
        function: functionForComponent(component),
        requirement: "Define requirement",
        industry: "Cross-industry reliability",
        failureMode,
        effect: "",
        cause: "",
        severity: "",
        occurrence: "",
        detection: "",
        correctiveAction: "",
        currentControl: defaultControls[index % defaultControls.length],
        owner: "",
        status: "needs_review" as const,
        included: true,
        rpn: "",
        evidenceCount: 0,
        sources: [],
      };
    }),
  );
}

function parseBom(text: string) {
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

function sourceLabel(source: Source) {
  if (source.doi) return `DOI: ${source.doi}`;
  if (source.url) return source.url;
  return source.category ? source.category.replace(/_/g, " ") : "Source record";
}

function evidenceSummary(row: FmeaRow) {
  return [
    ["Component", row.component],
    ["Failure mode", row.failureMode],
    ["Cause", row.cause],
    ["Effect", row.effect],
    ["Control / action", row.correctiveAction || row.currentControl],
  ].filter(([, value]) => String(value || "").trim());
}

function csvEscape(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function htmlEscape(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlEscape(value: string | number | undefined) {
  return htmlEscape(value).replace(/'/g, "&apos;");
}

function downloadFile(filename: string, mimeType: string, content: BlobPart | BlobPart[]) {
  const blob = new Blob(Array.isArray(content) ? content : [content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function rowRpn(row: FmeaRow) {
  const s = Number(row.severity);
  const o = Number(row.occurrence);
  const d = Number(row.detection);
  if (row.rpn) return row.rpn;
  if (!s || !o || !d) return "";
  return String(s * o * d);
}

function isComplete(row: FmeaRow) {
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

function buildCsv(rows: FmeaRow[]) {
  const headers = [
    "Component",
    "Function",
    "Failure mode",
    "Effect",
    "Severity",
    "Cause",
    "Occurrence",
    "Current controls",
    "Detection",
    "RPN",
    "Recommended action",
    "Owner",
    "Evidence count",
    "Sources",
  ];

  const body = rows.map((row) => [
    row.component,
    row.function,
    row.failureMode,
    row.effect,
    row.severity,
    row.cause,
    row.occurrence,
    row.currentControl,
    row.detection,
    rowRpn(row),
    row.correctiveAction,
    row.owner,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return [headers, ...body]
    .map((line) => line.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
}

function buildExcelHtml(rows: FmeaRow[]) {
  const headers = [
    "Component",
    "Function",
    "Failure mode",
    "Effect",
    "Severity",
    "Cause",
    "Occurrence",
    "Current controls",
    "Detection",
    "RPN",
    "Recommended action",
    "Owner",
    "Evidence count",
    "Sources",
  ];
  const body = rows.map((row) => [
    row.component,
    row.function,
    row.failureMode,
    row.effect,
    row.severity,
    row.cause,
    row.occurrence,
    row.currentControl,
    row.detection,
    rowRpn(row),
    row.correctiveAction,
    row.owner,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return buildXlsxWorkbook([headers, ...body]);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buffer: number[], value: number) {
  buffer.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(buffer: number[], value: number) {
  buffer.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function zipStore(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const centralDirectory: number[] = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const localOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, checksum);
    writeUint32(output, contentBytes.length);
    writeUint32(output, contentBytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    output.push(...nameBytes, ...contentBytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localOffset);
    centralDirectory.push(...nameBytes);
  }

  const centralOffset = output.length;
  output.push(...centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralOffset);
  writeUint16(output, 0);

  return new Uint8Array(output);
}

function buildXlsxWorkbook(rows: (string | number | undefined)[][]) {
  const columnWidths = [24, 30, 30, 38, 10, 34, 12, 34, 12, 10, 34, 18, 14, 55];
  const columnName = (index: number) => {
    let name = "";
    let value = index + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const columns = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${ref}"${style} t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="FMEA Export" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE85634"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
        "</styleSheet>",
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        `<cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}

// Group rows by component for tree structure
function groupRowsByComponent(rows: FmeaRow[]) {
  const grouped = new Map<string, FmeaRow[]>();
  rows.forEach((row) => {
    if (!grouped.has(row.component)) {
      grouped.set(row.component, []);
    }
    grouped.get(row.component)!.push(row);
  });
  return Array.from(grouped.entries()).map(([component, childRows]) => ({
    component,
    childRows,
  }));
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [selectionStep, setSelectionStep] = useState<SelectionStep>("initial");
  const [rows, setRows] = useState<FmeaRow[]>(() => toFmeaRows(bundledTurbofanData.rows));
  const [componentFilter, setComponentFilter] = useState("All");
  const [rowFilter, setRowFilter] = useState("all");
  const [componentQuery, setComponentQuery] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState("turbofan");
  const [manualComponents, setManualComponents] = useState<string[]>([]);
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [notice, setNotice] = useState("Start with the turbofan evidence set, upload a BOM, or choose components to narrow the worksheet.");
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [componentDropdownOpen, setComponentDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [cellViewer, setCellViewer] = useState<{ rowId: string; field: string; value: string } | null>(null);
  const groupsPerPage = 6;
  const components = useMemo(
    () => sortedComponentNames(Array.from(new Set(rows.map((row) => row.component)))),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = componentQuery.trim().toLowerCase();
        if (componentFilter !== "All" && row.component !== componentFilter) return false;
        if (
          query &&
          ![row.component, row.failureMode, row.effect, row.cause]
            .join(" ")
            .toLowerCase()
            .includes(query)
        ) {
          return false;
        }
        if (rowFilter === "with_effect" && !row.effect.trim()) return false;
        if (rowFilter === "missing_effect" && row.effect.trim()) return false;
        if (rowFilter === "evidence" && row.evidenceCount === 0) return false;
        if (rowFilter === "incomplete" && isComplete(row)) return false;
        if (rowFilter === "included" && !row.included) return false;
        return true;
      }),
    [componentFilter, componentQuery, rowFilter, rows],
  );

  const includedRows = rows.filter((row) => row.included);
  const incompleteRows = includedRows.filter((row) => !isComplete(row));
  const canExport = includedRows.length > 0;

  // Pagination keeps component groups intact, so related failure modes do not split oddly.
  const visibleGroupedData = useMemo(() => groupRowsByComponent(visibleRows), [visibleRows]);
  const totalPages = Math.max(1, Math.ceil(visibleGroupedData.length / groupsPerPage));
  const paginatedGroupedData = visibleGroupedData.slice(
    (currentPage - 1) * groupsPerPage,
    currentPage * groupsPerPage,
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [componentFilter, componentQuery, rowFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  // Initialize all components as expanded
  useEffect(() => {
    const componentNames = sortedComponentNames(Array.from(new Set(rows.map(row => row.component))));
    setExpandedComponents(new Set(componentNames));
  }, [rows]);

  function toggleComponent(componentName: string) {
    setExpandedComponents(current => {
      const newSet = new Set(current);
      if (newSet.has(componentName)) {
        newSet.delete(componentName);
      } else {
        newSet.add(componentName);
      }
      return newSet;
    });
  }

  function toggleManualComponent(componentName: string) {
    setManualComponents(current => {
      const newSet = new Set(current);
      if (newSet.has(componentName)) {
        newSet.delete(componentName);
      } else {
        newSet.add(componentName);
      }
      return Array.from(newSet);
    });
  }

  function collapseAllComponents() {
    setExpandedComponents(new Set());
  }

  function expandAllComponents() {
    setExpandedComponents(new Set(components));
  }

  function openCellViewer(rowId: string, field: string, value: string) {
    setCellViewer({ rowId, field, value });
  }

  function saveCellViewer(newValue: string) {
    if (!cellViewer) return;
    const fieldMap: Record<string, keyof FmeaRow> = {
      "Failure Mode": "failureMode",
      "Effect": "effect",
      "Cause": "cause",
      "Controls": "currentControl",
      "Action": "correctiveAction",
    };
    const field = fieldMap[cellViewer.field];
    if (field) {
      updateRow(cellViewer.rowId, { [field]: newValue });
    }
    setCellViewer(null);
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setComponentDropdownOpen(false);
      }
    }
    if (componentDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [componentDropdownOpen]);

  // Load saved data from localStorage on mount
  useEffect(() => {
    try {
      const savedData = localStorage.getItem("riskonradar-fmea-data");
      if (savedData) {
        const parsedRows = JSON.parse(savedData) as FmeaRow[];
        if (parsedRows.length > 0) {
          setRows(normalizeSavedRows(parsedRows));
          const savedTime = localStorage.getItem("riskonradar-fmea-saved-at");
          if (savedTime) {
            setLastSavedAt(savedTime);
          }
          setHasUnsavedChanges(false);
        }
      }
    } catch (error) {
      console.error("Failed to load saved FMEA data:", error);
    }
  }, []);

  const saveFmea = useCallback(() => {
    setIsSaving(true);
    window.setTimeout(() => {
      try {
        localStorage.setItem("riskonradar-fmea-data", JSON.stringify(rows));
        const now = new Date().toLocaleString();
        localStorage.setItem("riskonradar-fmea-saved-at", now);
        setLastSavedAt(now);
        setHasUnsavedChanges(false);
        setNotice("FMEA saved successfully.");
        setTimeout(() => setNotice(""), 3000);
      } catch {
        setNotice("Failed to save FMEA data.");
        setTimeout(() => setNotice(""), 3000);
      } finally {
        setIsSaving(false);
      }
    }, 150);
  }, [rows]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        saveFmea();
      }

      // Ctrl+? or Ctrl+H to open help
      if ((event.ctrlKey || event.metaKey) && (event.key === "?" || event.key === "h")) {
        event.preventDefault();
        setShowHelpModal(true);
      }

      // Escape to close dialog
      if (event.key === "Escape") {
        if (selectedSourceRow) {
          setSelectedSourceRow(null);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        } else if (showExportDropdown) {
          setShowExportDropdown(false);
        } else if (focusedCellId) {
          setFocusedCellId(null);
        } else if (cellViewer) {
          setCellViewer(null);
        }
      }

      // Ctrl+A to select all visible rows
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        event.preventDefault();
        const newSelection = new Set(visibleRows.map((row) => row.id));
        setSelectedRowIds(newSelection);
      }

      // Delete to remove selected rows
      if (event.key === "Delete" && selectedRowIds.size > 0) {
        if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
        event.preventDefault();
        if (confirm(`Delete ${selectedRowIds.size} selected row${selectedRowIds.size === 1 ? "" : "s"}?`)) {
          setRows((currentRows) => currentRows.filter((row) => !selectedRowIds.has(row.id)));
          setSelectedRowIds(new Set());
          setHasUnsavedChanges(true);
        }
      }

      // Ctrl+D to toggle include on selected rows
      if ((event.ctrlKey || event.metaKey) && event.key === "d") {
        event.preventDefault();
        setRows((currentRows) =>
          currentRows.map((row) =>
            selectedRowIds.has(row.id)
              ? { ...row, included: !row.included }
              : row,
          ),
        );
        setHasUnsavedChanges(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSourceRow, showExportDropdown, visibleRows, selectedRowIds, focusedCellId, showHelpModal, cellViewer, saveFmea]);

  const isLoading = loadingAction !== null;

  function updateRow(id: string, update: Partial<FmeaRow>) {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
    setHasUnsavedChanges(true);
  }

  function registerCell(rowId: string, field: EditableField, element: HTMLElement | null) {
    const key = `${rowId}:${field}`;
    if (element) {
      cellRefs.current.set(key, element);
    } else {
      cellRefs.current.delete(key);
    }
  }

  const focusCell = useCallback((rowId: string, field: EditableField) => {
    const target = cellRefs.current.get(`${rowId}:${field}`);
    target?.focus();
  }, []);

  const handleTableCellKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    rowId: string,
    field: EditableField,
  ) => {
    if (event.key !== "Tab") return;
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    const fieldIndex = editableFields.indexOf(field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    event.preventDefault();
    const flatIndex = rowIndex * editableFields.length + fieldIndex;
    const nextFlatIndex = flatIndex + (event.shiftKey ? -1 : 1);
    const maxIndex = visibleRows.length * editableFields.length - 1;
    const clampedIndex = Math.max(0, Math.min(maxIndex, nextFlatIndex));
    const nextRow = visibleRows[Math.floor(clampedIndex / editableFields.length)];
    const nextField = editableFields[clampedIndex % editableFields.length];
    if (nextRow && nextField) focusCell(nextRow.id, nextField);
  }, [focusCell, visibleRows]);

  const editableCellClass = useCallback((rowId: string, field: EditableField) => {
    return focusedCellId === `${rowId}:${field}` ? "cell-focused" : "";
  }, [focusedCellId]);

  function toggleRowSelection(rowId: string, event: MouseEvent | ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      // Multi-selection
      setSelectedRowIds(current => {
        const newSet = new Set(current);
        if (newSet.has(rowId)) {
          newSet.delete(rowId);
        } else {
          newSet.add(rowId);
        }
        return newSet;
      });
    } else {
      // Single selection (Ctrl+not held)
      setSelectedRowIds(new Set([rowId]));
    }
  }

  function importBomFile(file: File) {
    if (!file) return;
    setLoadingAction("upload");
    const text = file.text();
    text.then((text) => {
      const componentsFromBom = parseBom(text);
      if (!componentsFromBom.length) {
        setNotice("Could not detect components from that BOM. Try CSV, TSV, or one component per line.");
        setLoadingAction(null);
        return;
      }
      setRows(templateRowsForComponents(componentsFromBom));
      setSelectionStep("table");
      setNotice(`Imported ${componentsFromBom.length} BOM components. Edit the generated worksheet, then export when required fields are complete.`);
      setHasUnsavedChanges(true);
      setLoadingAction(null);
    }).catch(() => {
      setNotice("Failed to read file. Please try again.");
      setLoadingAction(null);
    });
  }

  function handleBomUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    importBomFile(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    importBomFile(file);
  }

  function rowsForSelectedComponents(datasetRows: EvidenceRow[], selectedComponents: string[]) {
    const selected = new Set(selectedComponents.map((component) => component.toLowerCase()));
    return datasetRows.filter((row) => selected.has(row.component.toLowerCase()));
  }

  async function startManualWorksheet() {
    const nextComponents = manualComponents.length ? manualComponents : components.slice(0, 5);
    setLoadingAction("system");
    setComponentFilter("All");
    setComponentQuery("");
    setRowFilter("all");
    try {
      const liveDataset = await fetchLiveTurbofanDataset();
      const evidenceRows = rowsForSelectedComponents(liveDataset.rows, nextComponents);
      const nextRows = evidenceRows.length ? toFmeaRows(evidenceRows) : templateRowsForComponents(nextComponents);
      setRows(nextRows);
      setNotice(
        evidenceRows.length
          ? `Loaded ${nextRows.length} evidence-backed FMEA row${nextRows.length === 1 ? "" : "s"} for ${nextComponents.length} selected component${nextComponents.length === 1 ? "" : "s"}.`
          : `Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`,
      );
    } catch {
      const evidenceRows = rowsForSelectedComponents(bundledTurbofanData.rows, nextComponents);
      const nextRows = evidenceRows.length ? toFmeaRows(evidenceRows) : templateRowsForComponents(nextComponents);
      setRows(nextRows);
      setNotice(
        evidenceRows.length
          ? `Loaded bundled evidence-backed FMEA rows for ${nextComponents.length} selected component${nextComponents.length === 1 ? "" : "s"}.`
          : `Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`,
      );
    } finally {
      setSelectionStep("table");
      setHasUnsavedChanges(true);
      setLoadingAction(null);
    }
  }

  async function fetchLiveTurbofanDataset() {
    const response = await fetch("/api/knowledge/fmea?limit=1000", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to load turbofan evidence (${response.status})`);
    }
    return (await response.json()) as FmeaDataset;
  }

  async function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    setLoadingAction("system");
    setSelectedSystemId(systemId);
    setComponentFilter("All");
    setComponentQuery("");
    try {
      if (systemId === "turbofan") {
        const liveDataset = await fetchLiveTurbofanDataset();
        const nextRows = toFmeaRows(liveDataset.rows);
        setRowFilter("all");
        setRows(nextRows);
        setNotice(`Loaded live turbofan evidence: ${liveDataset.recordCount} classified records, ${nextRows.length} merged FMEA rows.`);
      } else {
        setRowFilter("all");
        setRows(templateRowsForComponents(nextSystem.components));
        setNotice(`Loaded ${nextSystem.name}. Edit the generated worksheet, then export when required fields are complete.`);
      }
      setSelectionStep("table");
      setHasUnsavedChanges(true);
    } catch {
      if (systemId === "turbofan") {
        setRowFilter("all");
        setRows(toFmeaRows(bundledTurbofanData.rows));
        setSelectionStep("table");
        setNotice("Could not load live turbofan evidence. Using bundled worksheet snapshot.");
      } else {
        setNotice("Failed to load the selected system.");
      }
    } finally {
      setLoadingAction(null);
    }
  }

  function changeSystem() {
    if (hasUnsavedChanges) {
      const shouldContinue = confirm("You have unsaved worksheet changes. Change systems anyway?");
      if (!shouldContinue) return;
    }
    setSelectionStep("initial");
    setShowExportDropdown(false);
  }

  function handleManualSelection() {
    startManualWorksheet();
  }

  function exportData(format: "csv" | "excel") {
    setIsExporting(true);
    setLoadingAction("export");
    setTimeout(() => {
      if (format === "csv") {
        downloadFile("risk-on-radar-fmea.csv", "text/csv;charset=utf-8", buildCsv(includedRows));
      } else {
        downloadFile(
          "risk-on-radar-fmea.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buildExcelHtml(includedRows),
        );
      }
      setShowExportDropdown(false);
      setIsExporting(false);
      setLoadingAction(null);
    }, 100);
  }

  function HeaderLabel({ field, label }: { field: string; label: string }) {
    const helpText = fieldHelp[field];
    const showHelp = helpText && helpFields.has(field);
    return (
      <span className="header-label">
        <span className="header-label-text">{label}</span>
        {showHelp && (
          <button
            type="button"
            className="field-help"
            aria-label={`${label}: ${helpText}`}
            data-tooltip={helpText}
          >
            i
            <span className="field-help-tooltip" role="tooltip">
              {helpText}
            </span>
          </button>
        )}
      </span>
    );
  }

  function renderLongTextCell(row: FmeaRow, field: EditableField, label: string, value: string) {
    const displayValue = value.trim() || `Add ${label.toLowerCase()}`;
    const openText = () => openCellViewer(row.id, label, value);

    return (
      <button
        ref={(element) => registerCell(row.id, field, element)}
        type="button"
        className={`fmea-cell-control fmea-text-open ${editableCellClass(row.id, field)}`}
        aria-label={`Open full ${label.toLowerCase()} text for ${row.component} - ${row.failureMode}`}
        title={value || `Open ${label.toLowerCase()} text`}
        onPointerDown={(event) => {
          event.stopPropagation();
          openText();
        }}
        onClick={(event) => {
          event.stopPropagation();
          openText();
        }}
        onFocus={() => setFocusedCellId(`${row.id}:${field}`)}
        onBlur={() => setFocusedCellId(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openText();
            return;
          }
          handleTableCellKeyDown(event, row.id, field);
        }}
      >
        {displayValue}
      </button>
    );
  }

  // TanStack Table columns
  const columns: ColumnDef<FmeaRow>[] = [
      {
        id: "included",
        header: () => <HeaderLabel field="included" label="Export" />,
        cell: ({ row }) => {
          const toggleIncluded = () => updateRow(row.original.id, { included: !row.original.included });
          return (
            <input
              ref={(element) => registerCell(row.original.id, "included", element)}
              type="checkbox"
              checked={row.original.included}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleIncluded();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onChange={(event) => event.stopPropagation()}
              className="fmea-checkbox"
              aria-label={`Include ${row.original.component} - ${row.original.failureMode} in exported FMEA spreadsheet`}
              title="Include this row in the exported FMEA spreadsheet"
              onFocus={() => setFocusedCellId(`${row.original.id}:included`)}
              onBlur={() => setFocusedCellId(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleIncluded();
                  return;
                }
                handleTableCellKeyDown(event, row.original.id, "included");
              }}
            />
          );
        },
        size: 76,
      },
      {
        accessorKey: "component",
        header: () => <HeaderLabel field="component" label="Component" />,
        cell: ({ row }) => <span className="visually-hidden">{row.original.component}</span>,
        size: 120,
      },
      {
        accessorKey: "function",
        header: () => <HeaderLabel field="function" label="Function" />,
        cell: ({ row }) => <span>{row.original.function}</span>,
        size: 120,
      },
      {
        accessorKey: "industry",
        header: () => <HeaderLabel field="industry" label="Industry" />,
        cell: ({ row }) => <span>{row.original.industry}</span>,
        size: 92,
      },
      {
        accessorKey: "failureMode",
        header: () => <HeaderLabel field="failureMode" label="Failure Mode" />,
        cell: ({ row }) => renderLongTextCell(row.original, "failureMode", "Failure Mode", row.original.failureMode),
        size: 130,
      },
      {
        accessorKey: "effect",
        header: () => <HeaderLabel field="effect" label="Effect" />,
        cell: ({ row }) => renderLongTextCell(row.original, "effect", "Effect", row.original.effect),
        size: 120,
      },
      {
        accessorKey: "severity",
        header: () => <HeaderLabel field="severity" label="S" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "severity", element)}
            value={row.original.severity}
            onChange={(e) => updateRow(row.original.id, { severity: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "severity")}`}
            aria-label={`Severity score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:severity`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "severity")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 44,
      },
      {
        accessorKey: "cause",
        header: () => <HeaderLabel field="cause" label="Cause" />,
        cell: ({ row }) => renderLongTextCell(row.original, "cause", "Cause", row.original.cause),
        size: 120,
      },
      {
        accessorKey: "occurrence",
        header: () => <HeaderLabel field="occurrence" label="O" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "occurrence", element)}
            value={row.original.occurrence}
            onChange={(e) => updateRow(row.original.id, { occurrence: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "occurrence")}`}
            aria-label={`Occurrence score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:occurrence`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "occurrence")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 44,
      },
      {
        accessorKey: "currentControl",
        header: () => <HeaderLabel field="currentControl" label="Controls" />,
        cell: ({ row }) => renderLongTextCell(row.original, "currentControl", "Controls", row.original.currentControl),
        size: 120,
      },
      {
        accessorKey: "detection",
        header: () => <HeaderLabel field="detection" label="D" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "detection", element)}
            value={row.original.detection}
            onChange={(e) => updateRow(row.original.id, { detection: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "detection")}`}
            aria-label={`Detection score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:detection`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "detection")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 44,
      },
      {
        accessorKey: "rpn",
        header: () => <HeaderLabel field="rpn" label="RPN" />,
        cell: ({ row }) => <span className="rpn-value">{rowRpn(row.original) || "-"}</span>,
        size: 54,
      },
      {
        accessorKey: "correctiveAction",
        header: () => <HeaderLabel field="correctiveAction" label="Action" />,
        cell: ({ row }) => renderLongTextCell(row.original, "correctiveAction", "Action", row.original.correctiveAction),
        size: 120,
      },
      {
        id: "evidence",
        header: () => <HeaderLabel field="evidence" label="Evidence" />,
        cell: ({ row }) => (
          <button
            type="button"
            className="evidence-button"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedSourceRow(row.original);
            }}
            aria-label={`View evidence sources for ${row.original.component} - ${row.original.failureMode}`}
          >
            {row.original.evidenceCount || row.original.sources.length} sources
          </button>
        ),
        size: 86,
      },
      {
        accessorKey: "status",
        header: () => <HeaderLabel field="status" label="Status" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "status", element)}
            value={row.original.status}
            onChange={(e) =>
              updateRow(row.original.id, { status: e.target.value as FmeaRow["status"] })
            }
            className={`fmea-cell-control status-control ${editableCellClass(row.original.id, "status")}`}
            aria-label={`Review status for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:status`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "status")}
          >
            <option value="needs_review">Needs Review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        ),
        size: 104,
      },
    ];

  const visibleColumnCount = columns.length - 1;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const selectedTemplate = systemTemplates.find((system) => system.id === selectedSystemId) ?? systemTemplates[0];

  if (selectionStep === "initial") {
    return (
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <AppNav />

        <main id="main-content" className="app-main">
          <section className="workflow-card">
            <div className="workspace-start-layout">
              <div className="workspace-start-intro">
                <div className="page-heading workspace-start-heading">
                  <span className="metric-label">Evidence-backed FMEA workspace</span>
                  <h1>Start from a system model, then review the evidence row by row.</h1>
                  <p>
                    Load a prepared reliability workspace, narrow the analysis to selected components,
                    or import a BOM to generate an editable FMEA worksheet with citations.
                  </p>
                </div>

                <dl className="workspace-start-facts" aria-label="Loaded evidence snapshot">
                  <div>
                    <dt>Evidence records</dt>
                    <dd>{bundledTurbofanData.recordCount}</dd>
                  </div>
                  <div>
                    <dt>Merged rows</dt>
                    <dd>{bundledTurbofanData.rowCount}</dd>
                  </div>
                  <div>
                    <dt>Components</dt>
                    <dd>{bundledTurbofanData.components.length}</dd>
                  </div>
                </dl>
              </div>

              <div className="workspace-start-actions">
                <div className="workspace-start-panel workspace-start-panel-primary">
                  <div className="workspace-panel-heading">
                    <label className="field-label" htmlFor="system-template">
                      Select system
                    </label>
                    <strong>{selectedTemplate.name}</strong>
                    <span>{selectedTemplate.domain}</span>
                  </div>
                  <select
                    id="system-template"
                    value={selectedSystemId}
                    onChange={(event) => setSelectedSystemId(event.target.value)}
                  >
                    {systemTemplates.map((system) => (
                      <option key={system.id} value={system.id}>
                        {system.name} - {system.domain}
                      </option>
                    ))}
                  </select>
                  <p>{selectedTemplate.description}</p>
                  <span>{selectedTemplate.source}</span>
                  <button
                    className="btn btn-primary btn-full"
                    type="button"
                    onClick={() => loadSystem(selectedSystemId)}
                    disabled={isLoading}
                  >
                    {isLoading ? "Loading..." : "Open selected system"}
                  </button>
                </div>

                <div className="choice-divider" aria-hidden="true">
                  or
                </div>

                <div className="workspace-start-secondary">
                  <div className="workspace-start-panel">
                    <label className="field-label" htmlFor="manual-component">
                      Select components manually
                    </label>
                    <div className="component-picker" ref={dropdownRef}>
                      <button
                        type="button"
                        id="manual-component"
                        className="text-input component-picker-trigger"
                        onClick={() => setComponentDropdownOpen(!componentDropdownOpen)}
                        aria-expanded={componentDropdownOpen}
                        aria-controls="manual-component-list"
                      >
                        <span>
                          {manualComponents.length > 0
                            ? `${manualComponents.length} component${manualComponents.length === 1 ? "" : "s"} selected`
                            : "Choose components"
                          }
                        </span>
                        <span aria-hidden="true">v</span>
                      </button>
                      {componentDropdownOpen && (
                        <div id="manual-component-list" className="component-dropdown" role="group" aria-label="Available components">
                          {components.map((component) => (
                            <label key={component} className="dropdown-option">
                              <input
                                type="checkbox"
                                checked={manualComponents.includes(component)}
                                onChange={() => toggleManualComponent(component)}
                              />
                              <span>{component}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="component-chip-list" aria-label="Selected components">
                      {manualComponents.map((component) => (
                        <span key={component} className="component-chip">
                          {component}
                          <button
                            type="button"
                            className="chip-remove"
                            onClick={() => toggleManualComponent(component)}
                            aria-label={`Remove ${component}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <button
                      className="btn btn-secondary btn-full"
                      type="button"
                      onClick={handleManualSelection}
                    >
                      Start manual worksheet
                    </button>
                  </div>

                  <div className="choice-divider choice-divider-inline" aria-hidden="true">
                    or
                  </div>

                  <button
                    className="dropzone"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    disabled={isLoading}
                  >
                    <span>Import BOM</span>
                    <strong>{isLoading ? "Processing..." : "Drop BOM or component list here"}</strong>
                    <small>.csv, .tsv, or .txt</small>
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleBomUpload}
                aria-label="Upload BOM or component list file"
              />
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="container">
            <div className="footer-inner">
              <span className="wordmark wordmark-light">
                r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
              </span>
              <div className="footer-links">
                <a href="https://riskonradar.com/whitepaper.pdf" target="_blank" rel="noopener noreferrer" className="footer-link">
                  Whitepaper
                </a>
                <a href="https://www.linkedin.com/company/riskonradar/" target="_blank" rel="noopener noreferrer" className="footer-link">
                  LinkedIn
                </a>
                <a href="mailto:contact@riskonradar.com" className="footer-link">
                  contact@riskonradar.com
                </a>
              </div>
              <p className="footer-copy">© 2026 Risk on Radar. All rights reserved.</p>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <AppNav />

      <main id="main-content" className="app-main">
        <section className="workflow-card worksheet-workspace">
          {/* Header with Export */}
          <div className="fmea-header">
            <div>
              <span className="metric-label">FMEA Worksheet</span>
              <h1 className="fmea-title">Edit reliability analysis</h1>
            </div>
            <div className="fmea-header-actions">
              <button
                onClick={() => setShowHelpModal(true)}
                className="btn btn-secondary btn-sm"
                type="button"
                aria-label="Keyboard shortcuts and help"
              >
                ?
              </button>
              <button
                onClick={changeSystem}
                className="btn btn-secondary btn-sm"
                type="button"
              >
                Change system
              </button>
              <button
                onClick={saveFmea}
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              {lastSavedAt && (
                <span className="save-status">
                  Last saved: {lastSavedAt}{hasUnsavedChanges ? " · unsaved changes" : ""}
                </span>
              )}
              <div className="export-menu">
                <button
                  onClick={() => setShowExportDropdown(!showExportDropdown)}
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={isExporting || !canExport}
                  aria-describedby={!canExport ? "export-disabled-reason" : undefined}
                >
                  {isExporting ? "Exporting..." : "Export"}
                </button>
                {!canExport && (
                  <span id="export-disabled-reason" className="visually-hidden">
                    Include at least one row before exporting.
                  </span>
                )}
                {showExportDropdown && (
                  <div className="export-dropdown" role="menu" aria-label="Export formats">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportData("excel")}
                    >
                      Export as Excel
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportData("csv")}
                    >
                      Export as CSV
                    </button>
                  </div>
                )}
                {canExport && incompleteRows.length > 0 && (
                  <span className="export-hint" role="status">
                    {incompleteRows.length} included row{incompleteRows.length === 1 ? "" : "s"} export with blanks.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Worksheet Controls */}
          <div className="worksheet-controls">
            <div className="control-field control-field-wide">
              <label className="field-label" htmlFor="component-search">
                Search components
              </label>
              <input
                id="component-search"
                className="text-input"
                type="search"
                placeholder="Search bearing, compressor, turbine..."
                value={componentQuery}
                onChange={(event) => setComponentQuery(event.target.value)}
              />
            </div>

            <div className="control-field">
              <label className="field-label" htmlFor="component-filter">
                Component
              </label>
              <select
                id="component-filter"
                value={componentFilter}
                onChange={(event) => setComponentFilter(event.target.value)}
              >
                <option value="All">All components</option>
                {components.map((component) => (
                  <option key={component} value={component}>
                    {component}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-field">
              <label className="field-label" htmlFor="row-filter">
                Rows
              </label>
              <select
                id="row-filter"
                value={rowFilter}
                onChange={(event) => setRowFilter(event.target.value)}
              >
                <option value="all">All rows</option>
                <option value="with_effect">With effect</option>
                <option value="included">Included only</option>
                <option value="evidence">Evidence-backed</option>
                <option value="incomplete">Incomplete</option>
              </select>
            </div>

            <div className="control-field">
              <label className="field-label">
                Components
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={collapseAllComponents}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={expandAllComponents}
                >
                  Expand all
                </button>
              </div>
            </div>
          </div>

          {/* Notice */}
          {notice && (
            <p className="notice" role="status" aria-live="polite">{notice}</p>
          )}

          {/* Table */}
          <div className="grid-shell" id="worksheet">
            <div className="table-scroll">
              {isLoading && (
                <div className="table-loading" role="status">
                  {loadingAction === "upload" && "Processing file..."}
                  {loadingAction === "system" && "Loading system..."}
                  {loadingAction === "export" && "Preparing export..."}
                </div>
              )}
              <table className={`fmea-table ${focusedCellId ? "focus-mode" : ""}`}>
                <colgroup>
                  {worksheetColumnSpecs.map((column) => (
                    <col
                      key={column.id}
                      className={`col-${column.id}`}
                      style={{ width: `${column.size}px` }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr className="column-group-row">
                    <th colSpan={4}>Component details</th>
                    <th colSpan={6}>Failure analysis and scoring</th>
                    <th colSpan={4}>Evidence and review</th>
                  </tr>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers
                        .filter((header) => header.column.id !== "component")
                        .map((header) => (
                        <th
                          key={header.id}
                          className={`col-${header.column.id}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {paginatedGroupedData.map(({ component, childRows }) => (
                    <Fragment key={component}>
                      <tr className="component-section-row">
                        <td colSpan={visibleColumnCount}>
                          <div className="component-row-content">
                            <button
                              type="button"
                              className="component-toggle"
                              onClick={() => toggleComponent(component)}
                              aria-label={`${expandedComponents.has(component) ? "Collapse" : "Expand"} ${component}`}
                              aria-expanded={expandedComponents.has(component)}
                            >
                              <span className="toggle-icon" aria-hidden="true">{expandedComponents.has(component) ? "▼" : "▶"}</span>
                              <span className="toggle-label">Component</span>
                            </button>
                            <span className="component-name" title={component}>{component}</span>
                          </div>
                        </td>
                      </tr>
                      {expandedComponents.has(component) && childRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`fmea-data-row component-open-row ${selectedRowIds.has(row.id) ? "row-selected" : ""}`}
                          onClick={(event) => {
                            toggleRowSelection(row.id, event);
                          }}
                        >
                          {table.getRowModel().rows.find(r => r.original.id === row.id)?.getVisibleCells()
                            .filter((cell) => cell.column.id !== "component")
                            .map((cell) => (
                            <td
                              key={cell.id}
                              className={`col-${cell.column.id} ${focusedCellId?.startsWith(`${row.id}:`) && !cell.id.includes(focusedCellId.split(":")[1] ?? "") ? "cell-dimmed" : ""}`}
                              onClick={(event: MouseEvent<HTMLTableCellElement>) => {
                                if (["INPUT", "SELECT", "BUTTON"].includes((event.target as HTMLElement).tagName)) {
                                  event.stopPropagation();
                                }
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!visibleRows.length && <p className="empty-state">No rows match the current filters.</p>}
            </div>
          </div>

          {/* Footer Info */}
          <div className="table-pagination">
            <span>
              {visibleRows.length} rows ({includedRows.filter((r) => visibleRows.includes(r)).length} included)
            </span>
            <span>
              {incompleteRows.length} incomplete row{incompleteRows.length === 1 ? "" : "s"}
            </span>
            {selectedRowIds.size > 0 && (
              <span className="selection-count">
                {selectedRowIds.size} row{selectedRowIds.size === 1 ? "" : "s"} selected for batch actions
              </span>
            )}
            {totalPages > 1 && (
              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  ←
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  →
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="reference-section" aria-label="Scoring references">
          <details className="reference-disclosure">
            <summary>Severity scoring guide</summary>
            <div className="reference-table-wrap">
              <table className="reference-table severity-guide-table">
                <thead>
                  <tr>
                    <th>S</th>
                    <th>Class</th>
                    <th>System effect</th>
                    <th>Guidance</th>
                  </tr>
                </thead>
                <tbody>
                  {severityReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.classification}</td>
                      <td>{item.systemEffect}</td>
                      <td>{item.scoringGuidance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>Occurrence scoring guide</summary>
            <p className="reference-description">
              Proposed O uses weighted evidence count plus a cause modifier. EASA AD records count as
              2 evidence points, journal papers count as 1. Recurring degradation causes can add 1;
              event-dependent causes such as bird strike, FOD, or maintenance error can subtract 1.
            </p>
            <div className="reference-table-wrap">
              <table className="reference-table occurrence-guide-table">
                <thead>
                  <tr>
                    <th>O</th>
                    <th>Likelihood</th>
                    <th>Weighted evidence</th>
                    <th>Guidance</th>
                  </tr>
                </thead>
                <tbody>
                  {occurrenceReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.likelihood}</td>
                      <td>{item.weightedEvidence}</td>
                      <td>{item.scoringGuidance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>Detection scoring guide</summary>
            <p className="reference-description">
              Proposed D starts at 6. Clear inspection or monitoring terms subtract 2. EASA source
              titles with inspection, check, test, or replacement subtract 1. Internal or latent
              causes add 1. Sudden, event-dependent, or hard-to-predict failures add 2. The final
              value is clamped from 1 to 10.
            </p>
            <div className="reference-table-wrap">
              <table className="reference-table detection-guide-table">
                <thead>
                  <tr>
                    <th>D</th>
                    <th>Detectability</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {detectionReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.detectability}</td>
                      <td>{item.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>Severity propagation paths</summary>
            <div className="reference-table-wrap">
              <table className="reference-table propagation-table">
                <thead>
                  <tr>
                    <th>Cause</th>
                    <th>Component failure</th>
                    <th>Local effect</th>
                    <th>Engine effect</th>
                    <th>Mission consequence</th>
                    <th>S</th>
                  </tr>
                </thead>
                <tbody>
                  {propagationPaths.map((path) => (
                    <tr key={`${path.cause}-${path.componentFailure}`}>
                      <td>{path.cause}</td>
                      <td>{path.componentFailure}</td>
                      <td>{path.localEffect}</td>
                      <td>{path.engineEffect}</td>
                      <td>{path.aircraftMissionConsequence}</td>
                      <td>{path.suggestedSeverity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </main>

      {selectedSourceRow && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setSelectedSourceRow(null)}>
          <section
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence sources"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setSelectedSourceRow(null)}>
              ×
            </button>
            <span className="metric-label">Evidence</span>
            <h3>
              {selectedSourceRow.component} · {selectedSourceRow.failureMode}
            </h3>
            <p>
              Source-linked evidence remains review-required until an engineer accepts the row.
            </p>
            <ul className="source-list">
              <li>
                <strong>Extracted FMEA fields</strong>
                {evidenceSummary(selectedSourceRow).map(([label, value]) => (
                  <span key={label}>
                    {label}: {value}
                  </span>
                ))}
              </li>
              {selectedSourceRow.sources.map((source) => (
                <li key={[source.doi, source.title].filter(Boolean).join("|")}>
                  <strong>{source.title}</strong>
                  <span>
                    {sourceLabel(source)}
                    {source.year ? ` · ${source.year}` : ""}
                  </span>
                  {source.evidenceText ? (
                    <blockquote>{source.evidenceText}</blockquote>
                  ) : (
                    <span>Exact evidence span is not included in this bundled snapshot.</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {showHelpModal && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setShowHelpModal(false)}>
          <section
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts and help"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setShowHelpModal(false)}>
              ×
            </button>
            <span className="metric-label">Help</span>
            <h3>Keyboard Shortcuts</h3>
            <ul className="source-list">
              <li>
                <strong>Tab / Shift+Tab</strong>
                <span>Navigate between editable cells</span>
              </li>
              <li>
                <strong>Ctrl+S / Cmd+S</strong>
                <span>Save FMEA data</span>
              </li>
              <li>
                <strong>Ctrl+A / Cmd+A</strong>
                <span>Select all visible rows</span>
              </li>
              <li>
                <strong>Ctrl+Click / Cmd+Click</strong>
                <span>Add/remove row from selection (multi-select). Click without Ctrl for single selection.</span>
              </li>
              <li>
                <strong>Delete</strong>
                <span>Delete selected rows (with confirmation)</span>
              </li>
              <li>
                <strong>Ctrl+D / Cmd+D</strong>
                <span>Toggle include/exclude on selected rows</span>
              </li>
              <li>
                <strong>Ctrl+H / Ctrl+?</strong>
                <span>Open help modal</span>
              </li>
              <li>
                <strong>Escape</strong>
                <span>Close dialogs, dropdowns, or clear selection</span>
              </li>
            </ul>
            <h3>FMEA Field Explanations</h3>
            <ul className="source-list">
              <li>
                <strong>Component</strong>
                <span>Physical engineering part or subsystem being analyzed</span>
              </li>
              <li>
                <strong>Function</strong>
                <span>Intended function the component must perform</span>
              </li>
              <li>
                <strong>Failure Mode</strong>
                <span>How the component or function can fail</span>
              </li>
              <li>
                <strong>Effect</strong>
                <span>Consequence if the failure mode occurs</span>
              </li>
              <li>
                <strong>Severity (S)</strong>
                <span>Severity score: 1 is minor, 10 is hazardous or catastrophic</span>
              </li>
              <li>
                <strong>Cause</strong>
                <span>Why the failure mode occurs</span>
              </li>
              <li>
                <strong>Occurrence (O)</strong>
                <span>Occurrence score: 1 is rare, 10 is frequent</span>
              </li>
              <li>
                <strong>Controls</strong>
                <span>Existing prevention, detection, inspection, design, or maintenance control</span>
              </li>
              <li>
                <strong>Detection (D)</strong>
                <span>Detection score: 1 is easily detected before harm, 10 is unlikely to be detected</span>
              </li>
              <li>
                <strong>RPN</strong>
                <span>Risk Priority Number = S × O × D. Higher values indicate higher risk priority</span>
              </li>
              <li>
                <strong>Action</strong>
                <span>Recommended action to reduce risk or correct a confirmed issue</span>
              </li>
              <li>
                <strong>Evidence</strong>
                <span>Source count and citations behind the extracted FMEA fields</span>
              </li>
              <li>
                <strong>Status</strong>
                <span>Human review state for this row</span>
              </li>
            </ul>
            <h3>Row Status</h3>
            <ul className="source-list">
              <li>
                <strong>Needs Review</strong>
                <span>Row requires engineer review and validation</span>
              </li>
              <li>
                <strong>Accepted</strong>
                <span>Row has been reviewed and validated</span>
              </li>
              <li>
                <strong>Rejected</strong>
                <span>Row has been reviewed and rejected</span>
              </li>
            </ul>
          </section>
        </div>
      )}

      {cellViewer && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setCellViewer(null)}>
          <section
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${cellViewer.field}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setCellViewer(null)}>
              ×
            </button>
            <span className="metric-label">Edit</span>
            <h3>{cellViewer.field}</h3>
            <textarea
              value={cellViewer.value}
              onChange={(e) => setCellViewer({ ...cellViewer, value: e.target.value })}
              className="cell-viewer-textarea"
              rows={6}
              autoFocus
            />
            <div style={{ display: "flex", gap: "12px", marginTop: "20px", justifyContent: "flex-end" }}>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => setCellViewer(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => saveCellViewer(cellViewer.value)}
              >
                Save
              </button>
            </div>
          </section>
        </div>
      )}

      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <span className="wordmark wordmark-light">
              r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
            </span>
            <div className="footer-links">
              <a href="https://riskonradar.com/whitepaper.pdf" target="_blank" rel="noopener noreferrer" className="footer-link">
                Whitepaper
              </a>
              <a href="https://www.linkedin.com/company/riskonradar/" target="_blank" rel="noopener noreferrer" className="footer-link">
                LinkedIn
              </a>
              <a href="mailto:contact@riskonradar.com" className="footer-link">
                contact@riskonradar.com
              </a>
            </div>
            <p className="footer-copy">© 2026 Risk on Radar. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
