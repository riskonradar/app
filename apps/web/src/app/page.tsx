"use client";

import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { Fragment, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent } from "react";

import { AppNav } from "@/components/app-nav";
import fmeaData from "@/data/fmea-turbofan-data.json";
import severityReference from "@/data/fmea-severity-reference.json";
import occurrenceReference from "@/data/fmea-occurrence-reference.json";
import detectionReference from "@/data/fmea-detection-reference.json";
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

type SelectionStep = "initial" | "table";

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

function makeRowId(row: Pick<FmeaRow, "component" | "failureMode">, index: number) {
  return `${row.component}-${row.failureMode}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function toFmeaRows(rows: EvidenceRow[]): FmeaRow[] {
  return rows.map((row, index) => ({
    ...row,
    id: makeRowId(row, index),
    function: functionForComponent(row.component),
    requirement: "Maintain intended system function under defined operating conditions",
    currentControl: row.correctiveAction || defaultControls[index % defaultControls.length],
    owner: "",
    status: "needs_review",
    included: true,
  }));
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

function normalizeComponentList(components: string[]) {
  return Array.from(
    new Set(
      components
        .map((component) => component.trim())
        .filter(Boolean),
    ),
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

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
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
    "Included",
    "Component",
    "Function",
    "Requirement",
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
    "Review status",
    "Evidence count",
    "Sources",
  ];

  const body = rows.map((row) => [
    row.included ? "Yes" : "No",
    row.component,
    row.function,
    row.requirement,
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
    row.status,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return [headers, ...body]
    .map((line) => line.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
}

function buildExcelHtml(rows: FmeaRow[]) {
  const headers = [
    "Included",
    "Component",
    "Function",
    "Requirement",
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
    "Review status",
    "Evidence count",
    "Sources",
  ];
  const body = rows.map((row) => [
    row.included ? "Yes" : "No",
    row.component,
    row.function,
    row.requirement,
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
    row.status,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${[
    headers,
    ...body,
  ]
    .map((line) => `<tr>${line.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
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
  const [selectionStep, setSelectionStep] = useState<SelectionStep>("initial");
  const [rows, setRows] = useState<FmeaRow[]>(() => toFmeaRows(fmeaData.rows as EvidenceRow[]));
  const [componentFilter, setComponentFilter] = useState("All");
  const [rowFilter, setRowFilter] = useState("all");
  const [componentQuery, setComponentQuery] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState("turbofan");
  const [manualComponent, setManualComponent] = useState("");
  const [manualComponents, setManualComponents] = useState<string[]>([]);
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [notice, setNotice] = useState("Start with the turbofan evidence set, upload a BOM, or choose components to narrow the worksheet.");
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const components = useMemo(
    () => Array.from(new Set(rows.map((row) => row.component))).sort(),
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
  const canExport = includedRows.length > 0 && incompleteRows.length === 0;

  // Group visible rows by component for tree structure
  const groupedData = useMemo(() => groupRowsByComponent(visibleRows), [visibleRows]);

  function updateRow(id: string, update: Partial<FmeaRow>) {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
  }

  function importBomFile(file: File) {
    if (!file) return;
    const text = file.text();
    text.then((text) => {
      const componentsFromBom = parseBom(text);
      if (!componentsFromBom.length) {
        setNotice("Could not detect components from that BOM. Try CSV, TSV, or one component per line.");
        return;
      }
      setRows(templateRowsForComponents(componentsFromBom));
      setSelectionStep("table");
      setNotice(`Imported ${componentsFromBom.length} BOM components. Edit the generated worksheet, then export when required fields are complete.`);
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

  function handleManualComponentChange(component: string) {
    if (!component) return;
    setManualComponent(component);
    setManualComponents((current) => normalizeComponentList([...current, component]));
  }

  function startManualWorksheet() {
    const nextComponents = manualComponents.length ? manualComponents : components.slice(0, 5);
    setRows(templateRowsForComponents(nextComponents));
    setComponentFilter("All");
    setComponentQuery("");
    setRowFilter("all");
    setSelectionStep("table");
    setNotice(`Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`);
  }

  function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    setSelectedSystemId(systemId);
    setComponentFilter("All");
    setComponentQuery("");
    if (systemId === "turbofan") {
      setRowFilter("all");
      setRows(toFmeaRows(fmeaData.rows as EvidenceRow[]));
    } else {
      setRowFilter("all");
      setRows(templateRowsForComponents(nextSystem.components));
    }
    setSelectionStep("table");
  }

  function handleManualSelection() {
    startManualWorksheet();
  }

  function exportData(format: "csv" | "excel") {
    if (!canExport) {
      setValidationError(`Cannot export: ${incompleteRows.length} included row${incompleteRows.length === 1 ? "" : "s"} still need function, effect, cause, controls, or S/O/D scores.`);
      setTimeout(() => setValidationError(null), 5000);
      return;
    }

    if (format === "csv") {
      downloadFile("risk-on-radar-fmea.csv", "text/csv;charset=utf-8", buildCsv(includedRows));
    } else {
      downloadFile(
        "risk-on-radar-fmea.xls",
        "application/vnd.ms-excel;charset=utf-8",
        buildExcelHtml(includedRows),
      );
    }
    setShowExportDropdown(false);
  }

  function saveFmea() {
    // TODO: Implement save functionality (persist to backend/localStorage)
    setNotice("FMEA saved successfully!");
    setTimeout(() => setNotice(""), 3000);
  }

  // TanStack Table columns
  const columns = useMemo<ColumnDef<FmeaRow>[]>(
    () => [
      {
        id: "included",
        header: "",
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.original.included}
            onChange={(e) => updateRow(row.original.id, { included: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
          />
        ),
        size: 50,
      },
      {
        accessorKey: "component",
        header: "Component",
        cell: ({ row }) => <span className="visually-hidden">{row.original.component}</span>,
        size: 200,
      },
      {
        accessorKey: "function",
        header: "Function",
        cell: ({ row }) => <span>{row.original.function}</span>,
        size: 250,
      },
      {
        accessorKey: "requirement",
        header: "Requirement",
        cell: ({ row }) => <span>{row.original.requirement}</span>,
        size: 300,
      },
      {
        accessorKey: "failureMode",
        header: "Failure Mode",
        cell: ({ row }) => <span>{row.original.failureMode}</span>,
        size: 200,
      },
      {
        accessorKey: "effect",
        header: "Effect",
        cell: ({ row }) => (
          <input
            type="text"
            value={row.original.effect}
            onChange={(e) => updateRow(row.original.id, { effect: e.target.value })}
            className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          />
        ),
        size: 250,
      },
      {
        accessorKey: "severity",
        header: "S",
        cell: ({ row }) => (
          <select
            value={row.original.severity}
            onChange={(e) => updateRow(row.original.id, { severity: e.target.value })}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "cause",
        header: "Cause",
        cell: ({ row }) => (
          <input
            type="text"
            value={row.original.cause}
            onChange={(e) => updateRow(row.original.id, { cause: e.target.value })}
            className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          />
        ),
        size: 250,
      },
      {
        accessorKey: "occurrence",
        header: "O",
        cell: ({ row }) => (
          <select
            value={row.original.occurrence}
            onChange={(e) => updateRow(row.original.id, { occurrence: e.target.value })}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "currentControl",
        header: "Controls",
        cell: ({ row }) => (
          <input
            type="text"
            value={row.original.currentControl}
            onChange={(e) => updateRow(row.original.id, { currentControl: e.target.value })}
            className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          />
        ),
        size: 250,
      },
      {
        accessorKey: "detection",
        header: "D",
        cell: ({ row }) => (
          <select
            value={row.original.detection}
            onChange={(e) => updateRow(row.original.id, { detection: e.target.value })}
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "rpn",
        header: "RPN",
        cell: ({ row }) => <span className="font-mono">{rowRpn(row.original)}</span>,
        size: 80,
      },
      {
        accessorKey: "correctiveAction",
        header: "Action",
        cell: ({ row }) => (
          <input
            type="text"
            value={row.original.correctiveAction}
            onChange={(e) => updateRow(row.original.id, { correctiveAction: e.target.value })}
            className="w-full px-2 py-1 bg-transparent border border-transparent hover:border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          />
        ),
        size: 250,
      },
      {
        id: "evidence",
        header: "Evidence",
        cell: ({ row }) => (
          <button
            type="button"
            className="evidence-button"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedSourceRow(row.original);
            }}
          >
            {row.original.evidenceCount || row.original.sources.length} sources
          </button>
        ),
        size: 120,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <select
            value={row.original.status}
            onChange={(e) =>
              updateRow(row.original.id, { status: e.target.value as FmeaRow["status"] })
            }
            className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded focus:border-orange-500 focus:outline-none"
          >
            <option value="needs_review">Needs Review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        ),
        size: 120,
      },
    ],
    [],
  );

  const visibleColumnCount = columns.length - 1;

  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  if (selectionStep === "initial") {
    return (
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <AppNav />

        <main id="main-content" className="app-main">
          <section className="workflow-card">
            <div className="page-heading workspace-start-heading">
              <span className="metric-label">FMEA Workspace</span>
              <h1>Start your reliability analysis</h1>
              <p>
                Upload a component file, select a known system, or pick components manually.
              </p>
            </div>

            <div className="workspace-start-grid">
              <div className="workspace-start-panel">
                <label className="field-label" htmlFor="system-template">
                  Select system
                </label>
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
                <p>
                  {systemTemplates.find((system) => system.id === selectedSystemId)?.description}
                </p>
                <span>
                  {systemTemplates.find((system) => system.id === selectedSystemId)?.source}
                </span>
                <button
                  className="btn btn-primary btn-full"
                  type="button"
                  onClick={() => loadSystem(selectedSystemId)}
                >
                  Open selected system
                </button>
              </div>

              <div className="workspace-start-panel">
                <label className="field-label" htmlFor="manual-component">
                  Select components manually
                </label>
                <select
                  id="manual-component"
                  value={manualComponent}
                  onChange={(event) => handleManualComponentChange(event.target.value)}
                >
                  <option value="">Choose a component</option>
                  {components.map((component) => (
                    <option key={component} value={component}>
                      {component}
                    </option>
                  ))}
                </select>
                <div className="component-chip-list" aria-label="Selected components">
                  {(manualComponents.length ? manualComponents : ["No components selected yet"]).map((component) => (
                    <span key={component}>{component}</span>
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

              <button
                className="dropzone"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <strong>Drop BOM or component list here</strong>
                <span>CSV, TSV, or text. The first column is treated as component name.</span>
              </button>

              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleBomUpload}
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
        <section className="workflow-card">
          {/* Header with Export */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid var(--color-border)", background: "var(--color-deep)" }}>
            <div>
              <span className="metric-label">FMEA Worksheet</span>
              <h1 style={{ fontSize: "1.5rem", marginTop: "4px" }}>Edit reliability analysis</h1>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button
                onClick={saveFmea}
                className="btn btn-secondary btn-sm"
                type="button"
              >
                Save
              </button>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setShowExportDropdown(!showExportDropdown)}
                  className="btn btn-primary btn-sm"
                  type="button"
                    >
                      Export ▾
                </button>
                {showExportDropdown && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "8px",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    padding: "8px 0",
                    minWidth: "150px",
                    zIndex: 10,
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                  }}>
                    <button
                      onClick={() => exportData("excel")}
                      style={{
                        width: "100%",
                        padding: "8px 16px",
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Export as Excel
                    </button>
                    <button
                      onClick={() => exportData("csv")}
                      style={{
                        width: "100%",
                        padding: "8px 16px",
                        background: "transparent",
                        border: "none",
                        color: "var(--color-text)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      Export as CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div style={{
              padding: "12px 24px",
              background: "rgba(252, 165, 165, 0.1)",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--color-danger)",
              fontSize: "0.9rem",
            }}>
              {validationError}
            </div>
          )}

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
          </div>

          {/* Notice */}
          {notice && (
            <p className="notice">{notice}</p>
          )}

          {/* Table */}
          <div className="grid-shell" id="worksheet">
            <div style={{ overflow: "auto", height: "100%" }}>
              <table className="fmea-table">
                <thead style={{ position: "sticky", top: 0, background: "var(--color-deep)", zIndex: 5 }}>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers
                        .filter((header) => header.column.id !== "component")
                        .map((header) => (
                        <th
                          key={header.id}
                          style={{
                            padding: "12px",
                            textAlign: "left",
                            borderBottom: "1px solid var(--color-border)",
                            color: "var(--color-text-muted)",
                            fontWeight: 600,
                            fontSize: "0.8rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            width: header.getSize(),
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {groupedData.map(({ component, childRows }) => (
                    <Fragment key={component}>
                      <tr className="component-section-row">
                        <td colSpan={visibleColumnCount}>
                          <span>Component</span>
                          {component}
                        </td>
                      </tr>
                      {childRows.map((row) => (
                        <tr
                          key={row.id}
                          className="fmea-data-row"
                          onClick={() => setSelectedSourceRow(row)}
                        >
                          {table.getRowModel().rows.find(r => r.original.id === row.id)?.getVisibleCells()
                            .filter((cell) => cell.column.id !== "component")
                            .map((cell) => (
                            <td
                              key={cell.id}
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
          </div>
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
